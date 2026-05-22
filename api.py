"""FastAPI backend for Matchbox."""
from __future__ import annotations
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path
from typing import Optional

from thefuzz import process, fuzz

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tmdb_engine import TMDBEngine

app = FastAPI(title="Matchbox")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def _data_dir() -> Path:
    d = Path.home() / "Documents" / "Matchbox"
    d.mkdir(parents=True, exist_ok=True)
    return d

_DATA_DIR = _data_dir()
_CONFIG_FILE = _DATA_DIR / "config.json"


def _ffmpeg_exe() -> str:
    local = _DATA_DIR / "bin" / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    return str(local) if local.exists() else "ffmpeg"

def _ffprobe_exe() -> str:
    local = _DATA_DIR / "bin" / ("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
    return str(local) if local.exists() else "ffprobe"

_SPLIT_BUFFER = 8.0  # seconds to search around each split point for keyframes


def _probe_kf_after(src: Path, t: float) -> float:
    """Return PTS of the first video keyframe at or after `t` seconds.

    Uses frame-level probing (-show_frames, -skip_frame nonkey) for accurate
    timestamps on B-frame content where packet PTS can differ from frame PTS.
    """
    r = subprocess.run(
        [_ffprobe_exe(), "-v", "error", "-select_streams", "v:0",
         "-skip_frame", "nonkey",
         "-read_intervals", f"{max(0.0, t - 0.1):.6f}%+{_SPLIT_BUFFER + 2:.1f}",
         "-show_frames",
         "-show_entries", "frame=best_effort_timestamp_time,key_frame",
         "-of", "csv=p=0", str(src)],
        capture_output=True, text=True, timeout=30,
    )
    for line in r.stdout.splitlines():
        p = line.strip().split(",")
        if len(p) >= 2 and p[1].strip() == "1":
            try:
                pts = float(p[0])
                if pts >= t - 0.02:
                    return pts
            except (ValueError, IndexError):
                pass
    return t


def _probe_kf_before(src: Path, t: float) -> float:
    """Return PTS of the last video keyframe at or before `t` seconds."""
    ws = max(0.0, t - _SPLIT_BUFFER - 2)
    r = subprocess.run(
        [_ffprobe_exe(), "-v", "error", "-select_streams", "v:0",
         "-skip_frame", "nonkey",
         "-read_intervals", f"{ws:.6f}%+{t - ws + 1:.1f}",
         "-show_frames",
         "-show_entries", "frame=best_effort_timestamp_time,key_frame",
         "-of", "csv=p=0", str(src)],
        capture_output=True, text=True, timeout=30,
    )
    result = t  # fallback: treat cut point as already on a keyframe
    for line in r.stdout.splitlines():
        p = line.strip().split(",")
        if len(p) >= 2 and p[1].strip() == "1":
            try:
                pts = float(p[0])
                if pts <= t + 0.02:
                    result = pts
            except (ValueError, IndexError):
                pass
    return result


_CONFIG_DEFAULTS: dict = {
    "api_key": "", "path": "/", "pattern": " - ", "theme": "Slate",
    "whisper_model": "base", "whisper_language": "", "whisper_beam_size": 5, "whisper_vad": True,
    "custom_themes": [
        {"name": "Custom 1", "bg": "#13161e", "accent": "#3b82f6"},
        {"name": "Custom 2", "bg": "#0a0a0a", "accent": "#10b981"},
        {"name": "Custom 3", "bg": "#0c0814", "accent": "#a855f7"},
    ],
    "tv_template": "{e:02d}{sep}{title}",
    "movie_template": "{title} ({year})",
    "tv_path": "",
    "movie_path": "",
}


class ConfigManager:
    def __init__(self):
        self._cache: Optional[dict] = None

    def load(self) -> dict:
        if self._cache is not None:
            return self._cache
        data = dict(_CONFIG_DEFAULTS)
        if _CONFIG_FILE.exists():
            try:
                data.update(json.loads(_CONFIG_FILE.read_text()))
            except Exception:
                pass
        self._cache = data
        return data

    def save(self, updates: dict) -> dict:
        data = self.load()
        data.update(updates)
        _CONFIG_FILE.write_text(json.dumps(data, indent=2))
        self._cache = data
        return data


cfg = ConfigManager()
_engine: Optional[TMDBEngine] = None
_rename_history: list[tuple[str, str]] = []

HISTORY_FILE = _DATA_DIR / ".rename_history.json"


def _load_history() -> list[tuple[str, str]]:
    try:
        if HISTORY_FILE.exists():
            data = json.loads(HISTORY_FILE.read_text())
            return [tuple(p) for p in data]  # type: ignore[misc]
    except Exception:
        pass
    return []


def _save_history(history: list[tuple[str, str]]) -> None:
    try:
        HISTORY_FILE.write_text(json.dumps(history[-200:]))  # keep last 200 pairs
    except Exception:
        pass


_rename_history = _load_history()

PRESETS_FILE = _DATA_DIR / "presets.json"


def _load_presets() -> list[dict]:
    try:
        if PRESETS_FILE.exists():
            return json.loads(PRESETS_FILE.read_text())
    except Exception:
        pass
    return []


def _save_presets(presets: list[dict]) -> None:
    try:
        PRESETS_FILE.write_text(json.dumps(presets, indent=2))
    except Exception:
        pass


MATCH_HISTORY_FILE    = _DATA_DIR / "match_history.json"
ORGANIZE_HISTORY_FILE = _DATA_DIR / "organize_history.json"


def _load_match_history() -> dict:
    try:
        if MATCH_HISTORY_FILE.exists():
            return json.loads(MATCH_HISTORY_FILE.read_text())
    except Exception:
        pass
    return {}


def _save_match_history(h: dict) -> None:
    MATCH_HISTORY_FILE.write_text(json.dumps(h, indent=2))


TMDB_IMG_BASE = "https://image.tmdb.org/t/p"
VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".flv", ".ts", ".m2ts"}


def engine() -> TMDBEngine:
    global _engine
    config = cfg.load()
    if _engine is None or _engine.tmdb.api_key != config.get("api_key", ""):
        _engine = TMDBEngine(config["api_key"])
    return _engine


# ── Config ────────────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return cfg.load()


class ConfigUpdate(BaseModel):
    api_key: Optional[str] = None
    path: Optional[str] = None
    pattern: Optional[str] = None
    theme: Optional[str] = None
    whisper_model: Optional[str] = None
    whisper_language: Optional[str] = None
    whisper_beam_size: Optional[int] = None
    whisper_vad: Optional[bool] = None
    custom_themes: Optional[list] = None
    tv_template: Optional[str] = None
    movie_template: Optional[str] = None
    tv_path: Optional[str] = None
    movie_path: Optional[str] = None


@app.post("/api/config")
def save_config(body: ConfigUpdate):
    global _engine
    _engine = None
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    return cfg.save(updates)


# ── Presets ───────────────────────────────────────────────────────────────────

class PresetBody(BaseModel):
    name: str
    type: str       # 'remux' | 'subtitles'
    settings: dict


@app.get("/api/presets")
def get_presets(type: Optional[str] = Query(None)):
    presets = _load_presets()
    if type:
        presets = [p for p in presets if p.get("type") == type]
    return presets


@app.post("/api/presets")
def save_preset(body: PresetBody):
    presets = _load_presets()
    # Overwrite if same name + type already exists
    presets = [p for p in presets if not (p["name"] == body.name and p["type"] == body.type)]
    presets.append({"id": str(uuid.uuid4()), "name": body.name, "type": body.type, "settings": body.settings})
    _save_presets(presets)
    return [p for p in presets if p.get("type") == body.type]


@app.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str):
    presets = _load_presets()
    deleted_type = next((p["type"] for p in presets if p["id"] == preset_id), None)
    presets = [p for p in presets if p["id"] != preset_id]
    _save_presets(presets)
    return [p for p in presets if p.get("type") == deleted_type]


# ── Library ───────────────────────────────────────────────────────────────────

@app.get("/api/library")
def list_library(path: Optional[str] = Query(None)):
    config = cfg.load()
    root = path if (path and path != "/") else config.get("path", "/")
    base = Path(root)
    if not base.exists():
        return []
    return [
        {"name": d.name, "path": str(d)}
        for d in sorted(base.iterdir())
        if d.is_dir()
    ]


@app.get("/api/library/seasons")
def list_seasons(folder: str = Query(...)):
    p = Path(folder)
    if not p.exists() or not p.is_dir():
        raise HTTPException(400, "Invalid folder")
    with os.scandir(str(p)) as it:
        entries = sorted(it, key=lambda e: e.name)
    result = []
    for e in entries:
        if not e.is_dir(follow_symlinks=False):
            continue
        count = sum(
            1 for f in os.scandir(e.path)
            if f.is_file(follow_symlinks=False) and Path(f.name).suffix.lower() in VIDEO_EXTS
        )
        result.append({"name": e.name, "path": e.path, "file_count": count})
    direct = sum(
        1 for e in entries
        if e.is_file(follow_symlinks=False) and Path(e.name).suffix.lower() in VIDEO_EXTS
    )
    if direct:
        result.insert(0, {"name": p.name, "path": str(p), "file_count": direct})
    return result


@app.get("/api/library/files")
def list_files(folder: str = Query(...)):
    p = Path(folder)
    if not p.exists():
        raise HTTPException(400, "Invalid folder")
    return sorted([
        f.name for f in p.iterdir()
        if f.is_file() and f.suffix.lower() in VIDEO_EXTS
    ])


# ── TMDB — TV ─────────────────────────────────────────────────────────────────

@app.get("/api/search")
def search_shows(q: str = Query(...)):
    return engine().search_shows(q)


# ── TMDB — Movies ─────────────────────────────────────────────────────────────

@app.get("/api/search/movies")
def search_movies(q: str = Query(...)):
    # Strip leading numbered prefix ("01 - Title" → "Title") then trailing year
    clean = re.sub(r'^\d+\s*[-–.]\s*', '', q).strip()
    clean = re.sub(r'\s*[-–]?\s*\b(19|20)\d{2}\b\s*$', '', clean).strip() or clean
    results = engine().search_movies(clean)
    # Fallback to original query if cleaned version found nothing
    if not results and clean != q:
        results = engine().search_movies(q)
    return results


@app.get("/api/movie/{movie_id}")
def get_movie(movie_id: int):
    return engine().get_movie_details(movie_id)


@app.get("/api/show/{show_id}")
def get_show(show_id: int):
    details, seasons = engine().get_show_full(show_id)
    return {"details": details, "seasons": seasons}


@app.get("/api/show/{show_id}/season/{season_num}")
def get_season(show_id: int, season_num: int):
    details, episodes = engine().get_season_full(show_id, season_num)
    return {"details": details, "episodes": episodes}


# ── Image proxy ───────────────────────────────────────────────────────────────

@lru_cache(maxsize=512)
def _fetch_image(size: str, path: str) -> tuple[bytes, str]:
    url = f"{TMDB_IMG_BASE}/{size}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "Matchbox/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read(), resp.headers.get("Content-Type", "image/jpeg")


@app.get("/api/image")
def proxy_image(path: str = Query(...), size: str = Query("w342")):
    try:
        data, ct = _fetch_image(size, path)
        return Response(content=data, media_type=ct,
                        headers={"Cache-Control": "public, max-age=86400"})
    except Exception:
        raise HTTPException(404, "Image not found")


# ── Rename ────────────────────────────────────────────────────────────────────

class PreviewRequest(BaseModel):
    season_path: str
    mode: str = "numeric"       # "numeric" | "title" | "movie"
    # TV fields
    show_id: Optional[int] = None
    season_num: Optional[int] = None
    f_start: int = 1
    f_offset: int = 0
    pattern: Optional[str] = None
    # Movie field
    movie_id: Optional[int] = None
    # Optional: restrict processing to a single filename
    file_filter: Optional[str] = None


def _apply_template(tmpl: str, **fields) -> str:
    """Substitute {key} and {key:fmt} placeholders in a naming template."""
    def replace(m):
        key, fmt = m.group(1), m.group(2)
        val = fields.get(key)
        if val is None:
            return m.group(0)
        if fmt:
            try:
                return format(int(val), fmt)
            except Exception:
                return str(val)
        return str(val)
    return re.sub(r'\{(\w+)(?::([^}]*))?\}', replace, tmpl)


def _clean_filename(name: str) -> str:
    base = os.path.splitext(name)[0].replace(".", " ").replace("_", " ")
    return re.sub(r"(1080p|720p|x264|x265|HEVC|WEB-DL|BluRay|HDR|DV)", "", base, flags=re.I).strip()


def _extract_episode_num(filename: str) -> int | None:
    """Try to pull an episode number out of a filename for number-aware matching."""
    stem = Path(filename).stem
    # S01E07 / s01e07
    m = re.search(r'[Ss]\d{1,2}[Ee](\d{1,3})', stem)
    if m:
        return int(m.group(1))
    # Leading digits: "07 - Title" / "07.Title"
    m = re.match(r'^(\d{1,3})[\s._\-]', stem)
    if m:
        return int(m.group(1))
    # E07 anywhere
    m = re.search(r'[Ee](\d{1,3})(?:\b|$)', stem)
    if m:
        return int(m.group(1))
    # Trailing digits: "Title - 07"
    m = re.search(r'[\s._\-](\d{1,3})$', stem)
    if m:
        return int(m.group(1))
    return None


@app.post("/api/preview")
def preview(body: PreviewRequest):
    config = cfg.load()
    pattern = body.pattern if body.pattern is not None else config.get("pattern", " - ")
    tv_template = config.get("tv_template", "{e:02d}{sep}{title}")
    movie_template = config.get("movie_template", "{title} ({year})")
    eng = engine()

    base = Path(body.season_path)
    local_files = sorted([
        f for f in os.listdir(body.season_path)
        if os.path.isfile(base / f) and Path(f).suffix.lower() in VIDEO_EXTS
    ])
    if body.file_filter:
        local_files = [f for f in local_files if f == body.file_filter]

    # ── Movie mode ────────────────────────────────────────────────────────────
    if body.mode == "movie":
        if not body.movie_id:
            raise HTTPException(400, "movie_id required for movie mode")
        details = eng.get_movie_details(body.movie_id)
        title = eng._sanitize_title(details.get("title", "Unknown"))
        year = details.get("release_date", "")[:4]
        results = []
        for i, f in enumerate(local_files):
            ext = Path(f).suffix
            if len(local_files) == 1:
                label = _apply_template(movie_template, title=title, year=year, sep=pattern)
                new_file = f"{label}{ext}"
            else:
                label = _apply_template(movie_template, title=title, year=year, sep=pattern)
                new_file = f"{label} - Part {str(i + 1).zfill(2)}{ext}"
            results.append({
                "tmdb_num": i + 1,
                "tmdb_title": new_file.removesuffix(ext),
                "old_file": f,
                "new_file": new_file,
                "score": 100,
                "changed": f != new_file,
            })
        return {"episodes": results}

    # ── TV modes ──────────────────────────────────────────────────────────────
    if not body.show_id or body.season_num is None:
        raise HTTPException(400, "show_id and season_num required for TV mode")

    episodes = eng.get_episodes(body.show_id, body.season_num)
    results = []

    if body.mode == "title":
        tmdb_titles = [ep["name"] for ep in episodes]
        file_to_match: dict[str, tuple[str, int]] = {}
        for f in local_files:
            cleaned = _clean_filename(f)
            hit = process.extractOne(cleaned, tmdb_titles, scorer=fuzz.token_set_ratio)
            if hit and hit[1] > 30:
                title, score = hit[0], hit[1]
                prev = file_to_match.get(title)
                if prev is None or score > prev[1]:
                    file_to_match[title] = (f, score)

        for ep in episodes:
            match = file_to_match.get(ep["name"])
            if match:
                old_file, score = match
                clean_title = eng._sanitize_title(ep["name"])
                ext = Path(old_file).suffix
                new_file = _apply_template(tv_template, e=ep["num"] + body.f_offset, s=body.season_num, title=clean_title, sep=pattern) + ext
                results.append({
                    "tmdb_num": ep["num"],
                    "tmdb_title": ep["name"],
                    "old_file": old_file,
                    "new_file": new_file,
                    "score": score,
                    "changed": old_file != new_file,
                })
            else:
                results.append({
                    "tmdb_num": ep["num"],
                    "tmdb_title": ep["name"],
                    "old_file": None,
                    "new_file": None,
                    "score": 0,
                    "changed": False,
                })
    else:
        file_by_epnum: dict[int, str] = {}
        unnumbered: list[str] = []
        for f in local_files:
            n = _extract_episode_num(f)
            if n is not None and n not in file_by_epnum:
                file_by_epnum[n] = f
            else:
                unnumbered.append(f)

        unnumbered_it = iter(unnumbered)
        for ep in episodes:
            ep_num = ep["num"]
            if ep_num in file_by_epnum:
                old_file: str | None = file_by_epnum[ep_num]
            else:
                old_file = next(unnumbered_it, None)

            if old_file:
                clean_title = eng._sanitize_title(ep["name"])
                new_file = _apply_template(tv_template, e=ep_num + body.f_offset, s=body.season_num, title=clean_title, sep=pattern) + Path(old_file).suffix
                results.append({
                    "tmdb_num": ep_num,
                    "tmdb_title": ep["name"],
                    "old_file": old_file,
                    "new_file": new_file,
                    "score": 100,
                    "changed": old_file != new_file,
                })
            else:
                results.append({
                    "tmdb_num": ep_num,
                    "tmdb_title": ep["name"],
                    "old_file": None,
                    "new_file": None,
                    "score": 0,
                    "changed": False,
                })

    results.sort(key=lambda x: x["tmdb_num"])
    return {"episodes": results}


class RenameRequest(BaseModel):
    season_path: str
    pairs: list[dict]


@app.post("/api/rename")
def do_rename(body: RenameRequest):
    global _rename_history
    base = Path(body.season_path)
    done, errors = [], []
    history_batch: list[tuple[str, str]] = []

    # Collect pairs that actually need renaming
    valid: list[tuple[Path, Path]] = []
    for pair in body.pairs:
        old_path = base / pair["old"]
        new_path = base / pair["new"]
        if old_path.name == new_path.name:
            continue
        if not old_path.exists():
            errors.append(f"Not found: {pair['old']}")
            continue
        valid.append((old_path, new_path))

    # Phase 1: move each file to a temp name so within-batch collisions can't block us
    staged: list[tuple[Path, Path, Path]] = []  # (temp, new, original_old)
    for old_path, new_path in valid:
        temp_path = old_path.with_name(f".mbx_tmp_{old_path.name}")
        try:
            old_path.rename(temp_path)
            staged.append((temp_path, new_path, old_path))
        except Exception as e:
            errors.append(f"{old_path.name}: {e}")

    # Phase 2: move each temp file to its final name
    for temp_path, new_path, original_old in staged:
        if new_path.exists():
            # Allow case-only renames to overwrite (e.g. lowercase → Title Case).
            # Path.rename() is atomic on Linux and will replace the target.
            is_case_rename = new_path.name.lower() == original_old.name.lower()
            if not is_case_rename:
                try:
                    temp_path.rename(original_old)  # restore
                except Exception:
                    pass
                errors.append(f"Already exists: {new_path.name}")
                continue
        try:
            temp_path.rename(new_path)
            history_batch.append((str(new_path), str(original_old)))
            done.append(new_path.name)
        except Exception as e:
            errors.append(f"{original_old.name}: {e}")

    _rename_history.extend(history_batch)
    _save_history(_rename_history)
    return {"renamed": done, "errors": errors, "can_undo": bool(history_batch)}


@app.get("/api/undo/preview")
def undo_preview():
    return {"pairs": [
        {"current": Path(new_path).name, "original": Path(old_path).name}
        for new_path, old_path in reversed(_rename_history)
    ]}


@app.post("/api/undo")
def undo_rename():
    global _rename_history
    if not _rename_history:
        raise HTTPException(400, "Nothing to undo")
    restored, errors = [], []
    while _rename_history:
        new_path, old_path = _rename_history.pop()
        try:
            Path(new_path).rename(Path(old_path))
            restored.append(Path(old_path).name)
        except Exception as e:
            errors.append(f"{e}")
    _save_history(_rename_history)
    return {"restored": restored, "errors": errors}


# ── Organizer ────────────────────────────────────────────────────────────────

def _scan_video_files(root: Path) -> list[tuple[str, str, str]]:
    """Recursively find all video files. Returns [(rel_folder, filename, full_path)]."""
    results = []
    for dirpath, dirs, files in os.walk(str(root)):
        dirs.sort()
        rel = str(Path(dirpath).relative_to(root))
        rel = "" if rel == "." else rel
        for f in sorted(files):
            if Path(f).suffix.lower() in VIDEO_EXTS:
                results.append((rel, f, os.path.join(dirpath, f)))
    return results


def _az_folder(filename: str) -> str:
    stem = Path(filename).stem
    # Strip leading numbered prefix: "01 - Title" → "Title"
    stem = re.sub(r'^\d+\s*[-–.]\s*', '', stem).strip()
    # Strip leading article for sort key: "The Dark Knight" → "D"
    key = stem
    for art in ("the ", "a ", "an "):
        if stem.lower().startswith(art):
            key = stem[len(art):]
            break
    ch = key.strip()[0].upper() if key.strip() else "#"
    return ch if ch.isalpha() else "#"


def _parse_title_year_org(filename: str) -> tuple[str, str]:
    stem = Path(filename).stem
    # Strip leading numbered prefix: "01 - Title" or "18 -Title" → "Title"
    stem = re.sub(r'^\d+\s*[-–.]\s*', '', stem).strip()
    m = re.match(r"^(.+?)\s*[-–]\s*(\d{4})\s*$", stem) or \
        re.match(r"^(.+?)\s*\((\d{4})\)\s*$", stem)
    if m:
        return m.group(1).strip(), m.group(2)
    return stem.strip(), ""


def _clean_collection_name(name: str) -> str:
    for suffix in (" Collection", " Series", " Franchise", " Films", " Trilogy", " Universe", " Saga"):
        if name.endswith(suffix):
            return name[: -len(suffix)].strip()
    return name.strip()


def _tmdb_lookup(title: str, year: str, scheme: str, api_key: str) -> str:
    """Look up genre or franchise folder for a movie. Thread-safe: each call owns its engine."""
    from tmdb_engine import TMDBEngine
    eng = TMDBEngine(api_key)
    try:
        # Search by title only; year used to pick the right result when there are duplicates
        results = eng.search_movies(title)
        if not results:
            return "Other" if scheme == "genre" else ""
        # Prefer result whose release year matches
        match = next((r for r in results if r.get("year") == year), results[0])
        d = eng.movie.details(match["id"])
        if scheme == "genre":
            genres = getattr(d, "genres", []) or []
            return genres[0]["name"] if genres else "Other"
        elif scheme == "studio":
            companies = getattr(d, "production_companies", []) or []
            if companies:
                c = companies[0]
                name = c.get("name", "") if hasattr(c, "get") else getattr(c, "name", "")
                return name if name else "Other"
            return "Other"
        else:  # franchise
            col = getattr(d, "belongs_to_collection", None)
            if col:
                name = col.get("name", "") if hasattr(col, "get") else getattr(col, "name", "")
                return _clean_collection_name(name) if name else ""
            return ""  # standalone — goes to root
    except Exception:
        return "Other" if scheme in ("genre", "studio") else ""


def _organize_stream(movie_path: Path, scheme: str, api_key: str):
    """Generator yielding NDJSON lines describing proposed moves."""
    all_files = _scan_video_files(movie_path)
    total = len(all_files)

    def make_entry(rel_folder, filename, full_path, target_folder):
        src = f"{rel_folder}/{filename}" if rel_folder else filename
        dst = f"{target_folder}/{filename}" if target_folder else filename
        return json.dumps({
            "type": "move",
            "source": src,
            "dest": dst,
            "source_full": full_path,
            "dest_full": str(movie_path / dst),
            "folder": target_folder,
            "changed": src != dst,
        })

    if scheme in ("flat", "az", "year"):
        for rel_folder, filename, full_path in all_files:
            if scheme == "flat":
                folder = ""
            elif scheme == "az":
                folder = _az_folder(filename)
            else:  # year
                m = re.search(r'\b((?:19|20)\d{2})\b', filename)
                folder = m.group(1) if m else "Unknown"
            yield make_entry(rel_folder, filename, full_path, folder) + "\n"
        yield json.dumps({"type": "done", "total": total}) + "\n"
        return

    # Genre / Franchise / Studio — parallel TMDB lookups
    yield json.dumps({"type": "progress", "done": 0, "total": total}) + "\n"

    def lookup(item):
        rel_folder, filename, full_path = item
        title, year = _parse_title_year_org(filename)
        folder = _tmdb_lookup(title, year, scheme, api_key)
        return rel_folder, filename, full_path, folder

    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(lookup, item): item for item in all_files}
        for future in as_completed(futures):
            rel_folder, filename, full_path, folder = future.result()
            done += 1
            yield make_entry(rel_folder, filename, full_path, folder) + "\n"
            yield json.dumps({"type": "progress", "done": done, "total": total}) + "\n"

    yield json.dumps({"type": "done", "total": total}) + "\n"


class OrganizePreviewRequest(BaseModel):
    movie_path: str
    scheme: str  # "flat" | "az" | "year" | "genre" | "studio" | "franchise"


class OrganizeMoveEntry(BaseModel):
    source_full: str
    dest_full: str
    source: str
    dest: str


class OrganizeApplyRequest(BaseModel):
    moves: list[OrganizeMoveEntry]


@app.post("/api/organize/preview")
def organize_preview(body: OrganizePreviewRequest):
    api_key = cfg.load().get("api_key", "")
    return StreamingResponse(
        _organize_stream(Path(body.movie_path), body.scheme, api_key),
        media_type="application/x-ndjson",
    )


@app.post("/api/organize/apply")
def organize_apply(body: OrganizeApplyRequest):
    moved, errors = [], []
    history_entries: list[dict] = []
    roots_to_clean: set[Path] = set()
    for m in body.moves:
        src, dst = Path(m.source_full), Path(m.dest_full)
        if not src.exists():
            errors.append(f"Not found: {m.source}")
            continue
        if dst.exists():
            errors.append(f"Already exists, skipped: {m.dest}")
            continue
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            moved.append(m.source)
            history_entries.append({"source": m.source_full, "dest": m.dest_full})
            roots_to_clean.add(src.parent)
        except Exception as e:
            errors.append(f"{m.source}: {e}")
    # Remove directories that are now empty (bottom-up)
    for d in sorted(roots_to_clean, key=lambda p: len(p.parts), reverse=True):
        try:
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        except Exception:
            pass
    # Save undo history
    if history_entries:
        try:
            ORGANIZE_HISTORY_FILE.write_text(json.dumps(history_entries, indent=2))
        except Exception:
            pass
    return {"moved": len(moved), "errors": errors}


@app.get("/api/organize/undo/preview")
def organize_undo_preview():
    if not ORGANIZE_HISTORY_FILE.exists():
        return {"moves": []}
    try:
        return {"moves": json.loads(ORGANIZE_HISTORY_FILE.read_text())}
    except Exception:
        return {"moves": []}


@app.post("/api/organize/undo")
def organize_undo():
    if not ORGANIZE_HISTORY_FILE.exists():
        return {"restored": 0, "errors": []}
    try:
        history = json.loads(ORGANIZE_HISTORY_FILE.read_text())
    except Exception:
        return {"restored": 0, "errors": ["Could not read organize history"]}
    restored, errors = [], []
    roots_to_clean: set[Path] = set()
    for item in history:
        src = Path(item["dest"])    # where it currently lives
        dst = Path(item["source"])  # where it came from
        if not src.exists():
            errors.append(f"Not found: {src.name}")
            continue
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            restored.append(src.name)
            roots_to_clean.add(src.parent)
        except Exception as e:
            errors.append(f"{src.name}: {e}")
    # Clean up directories that are now empty
    for d in sorted(roots_to_clean, key=lambda p: len(p.parts), reverse=True):
        try:
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        except Exception:
            pass
    ORGANIZE_HISTORY_FILE.unlink(missing_ok=True)
    return {"restored": len(restored), "errors": errors}


# ── Remux ─────────────────────────────────────────────────────────────────────

class RemuxRequest(BaseModel):
    folder_path: str
    files: list[str]
    target_format: str       # "mkv", "mp4", "m4v", "avi"
    delete_original: bool = False
    default_audio_track: Optional[int] = None     # 1-based audio track position
    default_subtitle_track: Optional[int] = None  # 1-based subtitle track position


@app.get("/api/remux/check")
def check_ffmpeg():
    try:
        r = subprocess.run([_ffmpeg_exe(), "-version"], capture_output=True, timeout=5)
        return {"available": r.returncode == 0}
    except Exception:
        return {"available": False}


@app.get("/api/ffmpeg/install")
def install_ffmpeg():
    def generate():
        import tarfile as _tarfile, zipfile as _zipfile
        bin_dir = _DATA_DIR / "bin"
        bin_dir.mkdir(parents=True, exist_ok=True)

        if sys.platform == "win32":
            url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
            names = {"ffmpeg.exe", "ffprobe.exe"}
        else:
            url = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
            names = {"ffmpeg", "ffprobe"}

        tmp = Path(tempfile.mktemp(suffix=".tmp", dir=str(bin_dir)))
        try:
            yield f"data: {json.dumps({'status': 'downloading', 'progress': 0})}\n\n"
            req = urllib.request.urlopen(url, timeout=120)
            total = int(req.headers.get("Content-Length") or 0)
            downloaded = 0
            last_pct = -1
            with open(tmp, "wb") as f:
                while True:
                    chunk = req.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = min(79, int(downloaded / total * 80))
                        if pct != last_pct:
                            last_pct = pct
                            yield f"data: {json.dumps({'status': 'downloading', 'progress': pct})}\n\n"

            yield f"data: {json.dumps({'status': 'extracting', 'progress': 80})}\n\n"

            if sys.platform == "win32":
                with _zipfile.ZipFile(tmp) as z:
                    for member in z.namelist():
                        n = Path(member).name
                        if n in names:
                            with z.open(member) as src_f, open(bin_dir / n, "wb") as dst:
                                dst.write(src_f.read())
            else:
                with _tarfile.open(tmp, "r:xz") as t:
                    for member in t.getmembers():
                        n = Path(member.name).name
                        if n in names:
                            f_obj = t.extractfile(member)
                            if f_obj:
                                out = bin_dir / n
                                with open(out, "wb") as dst:
                                    dst.write(f_obj.read())
                                out.chmod(0o755)

            yield f"data: {json.dumps({'status': 'done', 'progress': 100})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'error': str(e)})}\n\n"
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class AudioTracksRequest(BaseModel):
    folder_path: str
    files: list[str]


def _probe_streams(path: Path, stream_type: str) -> list:
    p = subprocess.run(
        [_ffprobe_exe(), "-v", "error", "-select_streams", stream_type,
         "-show_entries", "stream=index,codec_name:stream_tags=language,title",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=15,
    )
    if p.returncode != 0:
        return []
    streams = json.loads(p.stdout or "{}").get("streams", [])
    return [
        {"position": pos, "stream_index": s.get("index"),
         "codec": s.get("codec_name"),
         "language": (s.get("tags") or {}).get("language"),
         "title": (s.get("tags") or {}).get("title")}
        for pos, s in enumerate(streams, start=1)
    ]


@app.post("/api/remux/audio-tracks")
def get_audio_tracks(body: AudioTracksRequest):
    base = Path(body.folder_path)
    if not base.exists():
        raise HTTPException(400, "Folder not found")

    result = []
    max_audio_tracks = 0
    max_subtitle_tracks = 0
    for fname in body.files:
        src = base / fname
        if not src.exists() or not src.is_file():
            continue
        try:
            tracks = _probe_streams(src, "a")
            subtitle_tracks = _probe_streams(src, "s")
            max_audio_tracks = max(max_audio_tracks, len(tracks))
            max_subtitle_tracks = max(max_subtitle_tracks, len(subtitle_tracks))
            result.append({"file": fname, "tracks": tracks, "subtitle_tracks": subtitle_tracks})
        except Exception:
            result.append({"file": fname, "tracks": [], "subtitle_tracks": []})

    return {"files": result, "max_audio_tracks": max_audio_tracks, "max_subtitle_tracks": max_subtitle_tracks}


def _audio_track_count(path: Path) -> int:
    cmd = [
        _ffprobe_exe(),
        "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=index",
        "-of", "json",
        str(path),
    ]
    try:
        probe = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if probe.returncode != 0:
            return 0
        data = json.loads(probe.stdout or "{}")
        return len(data.get("streams", []))
    except Exception:
        return 0


@app.post("/api/remux")
def start_remux(body: RemuxRequest):
    base = Path(body.folder_path)
    if not base.exists():
        raise HTTPException(400, "Folder not found")
    target_ext = body.target_format.lstrip(".").lower()
    default_audio_idx = body.default_audio_track - 1 if body.default_audio_track else None
    default_subtitle_idx = body.default_subtitle_track - 1 if body.default_subtitle_track else None

    def generate():
        total = len(body.files)
        for idx, fname in enumerate(body.files):
            src = base / fname
            src_ext = Path(fname).suffix.lstrip(".").lower()

            yield f"data: {json.dumps({'file': fname, 'status': 'running', 'done': idx, 'total': total})}\n\n"

            if src_ext == target_ext and default_audio_idx is None and default_subtitle_idx is None:
                yield f"data: {json.dumps({'file': fname, 'status': 'skipped', 'reason': 'same format', 'done': idx + 1, 'total': total})}\n\n"
                continue

            if not src.exists():
                yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': 'File not found', 'done': idx + 1, 'total': total})}\n\n"
                continue

            same_format = src_ext == target_ext
            dst_name = Path(fname).stem + "." + target_ext
            dst = base / dst_name
            final_name = dst_name
            disposition_only = same_format and (default_audio_idx is not None or default_subtitle_idx is not None)
            if disposition_only:
                dst = base / f"{Path(fname).stem}.disposition.tmp{Path(fname).suffix}"
                final_name = fname

            # Probe duration for progress calculation
            dur_probe = subprocess.run(
                [_ffprobe_exe(), "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(src)],
                capture_output=True, text=True, timeout=15,
            )
            try:
                duration = float(dur_probe.stdout.strip())
            except (ValueError, AttributeError):
                duration = 0.0

            cmd = [_ffmpeg_exe(), "-y", "-v", "quiet", "-i", str(src)]
            if target_ext == "mkv" or default_audio_idx is not None or default_subtitle_idx is not None:
                cmd.extend(["-map", "0", "-c", "copy"])
            else:
                cmd.extend(["-c:v", "copy", "-c:a", "copy"])
            if default_audio_idx is not None:
                cmd.extend(["-disposition:a", "0", f"-disposition:a:{default_audio_idx}", "default"])
            if default_subtitle_idx is not None:
                cmd.extend(["-disposition:s", "0", f"-disposition:s:{default_subtitle_idx}", "default"])
            cmd.extend(["-progress", "pipe:1", str(dst)])

            try:
                with tempfile.TemporaryFile() as stderr_tmp:
                    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=stderr_tmp)
                    for raw_line in proc.stdout:  # type: ignore[union-attr]
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if line.startswith("out_time_us=") and duration > 0:
                            try:
                                pct = min(99, int(int(line.split("=")[1]) / (duration * 1_000_000) * 100))
                                yield f"data: {json.dumps({'file': fname, 'status': 'running', 'progress': pct, 'done': idx, 'total': total})}\n\n"
                            except (ValueError, ZeroDivisionError):
                                pass
                    try:
                        proc.wait(timeout=60)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                    stderr_tmp.seek(0)
                    stderr_output = stderr_tmp.read().decode("utf-8", errors="replace")[-300:]

                if proc.returncode == 0:
                    if disposition_only:
                        os.replace(dst, src)
                    elif body.delete_original:
                        src.unlink(missing_ok=True)
                    yield f"data: {json.dumps({'file': fname, 'out': final_name, 'status': 'done', 'done': idx + 1, 'total': total})}\n\n"
                else:
                    if dst.exists():
                        dst.unlink(missing_ok=True)
                    yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': stderr_output, 'done': idx + 1, 'total': total})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': str(exc), 'done': idx + 1, 'total': total})}\n\n"

        yield f"data: {json.dumps({'status': 'complete', 'total': total})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Whisper subtitle generation ───────────────────────────────────────────────

WHISPER_MODELS = ["tiny", "base", "small", "medium", "large"]


def _fmt_srt_time(seconds: float) -> str:
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    ms = round((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


@app.get("/api/whisper/check")
def check_whisper():
    try:
        import faster_whisper  # noqa: F401
        return {"available": True, "models": WHISPER_MODELS}
    except ImportError:
        return {"available": False, "models": []}


class WhisperRequest(BaseModel):
    folder_path: str
    files: list[str]
    model: str = "base"
    language: Optional[str] = None
    vad_filter: bool = True
    beam_size: int = 5
    initial_prompt: Optional[str] = None
    audio_track: Optional[int] = None  # 1-based; None = let Whisper choose


@app.post("/api/whisper")
def generate_subtitles(body: WhisperRequest):
    base = Path(body.folder_path)
    if not base.exists():
        raise HTTPException(400, "Folder not found")

    def generate():
        try:
            from faster_whisper import WhisperModel
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'error': f'Cannot load faster-whisper: {e}'})}\n\n"
            return

        total = len(body.files)
        model = None

        for idx, fname in enumerate(body.files):
            src = base / fname
            yield f"data: {json.dumps({'file': fname, 'status': 'running', 'done': idx, 'total': total})}\n\n"

            if not src.exists():
                yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': 'File not found', 'done': idx + 1, 'total': total})}\n\n"
                continue

            tmp_audio: Optional[Path] = None
            try:
                if model is None:
                    yield f"data: {json.dumps({'file': fname, 'status': 'loading_model', 'model': body.model, 'done': idx, 'total': total})}\n\n"
                    model = WhisperModel(body.model, device="cpu", compute_type="int8")

                transcribe_path = str(src)
                if body.audio_track is not None:
                    audio_idx = body.audio_track - 1
                    tmp_audio = Path(tempfile.mktemp(suffix=".wav", dir="/tmp"))
                    r = subprocess.run(
                        [_ffmpeg_exe(), "-y", "-i", str(src),
                         "-map", f"0:a:{audio_idx}",
                         "-ar", "16000", "-ac", "1", "-f", "wav", str(tmp_audio)],
                        capture_output=True, timeout=300,
                    )
                    if r.returncode != 0:
                        yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': 'Failed to extract audio track', 'done': idx + 1, 'total': total})}\n\n"
                        continue
                    transcribe_path = str(tmp_audio)

                kwargs: dict = {
                    "beam_size": body.beam_size,
                    "vad_filter": body.vad_filter,
                    "repetition_penalty": 1.1,
                    "no_repeat_ngram_size": 3,
                }
                if body.vad_filter:
                    kwargs["hallucination_silence_threshold"] = 2.0
                if body.language:
                    kwargs["language"] = body.language
                if body.initial_prompt:
                    kwargs["initial_prompt"] = body.initial_prompt

                segments, info = model.transcribe(transcribe_path, **kwargs)

                srt_name = src.stem + ".srt"
                srt_path = base / srt_name
                last_pct = -1
                with open(srt_path, "w", encoding="utf-8") as f:
                    for i, seg in enumerate(segments, 1):
                        f.write(f"{i}\n{_fmt_srt_time(seg.start)} --> {_fmt_srt_time(seg.end)}\n{seg.text.strip()}\n\n")
                        if info.duration > 0:
                            pct = min(99, int(seg.end / info.duration * 100))
                            if pct != last_pct:
                                last_pct = pct
                                yield f"data: {json.dumps({'file': fname, 'status': 'running', 'progress': pct, 'done': idx, 'total': total})}\n\n"

                yield f"data: {json.dumps({'file': fname, 'out': srt_name, 'status': 'done', 'language': info.language, 'done': idx + 1, 'total': total})}\n\n"

            except Exception as exc:
                yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': str(exc)[:200], 'done': idx + 1, 'total': total})}\n\n"
            finally:
                if tmp_audio and tmp_audio.exists():
                    tmp_audio.unlink(missing_ok=True)

        yield f"data: {json.dumps({'status': 'complete', 'total': total})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Match History ─────────────────────────────────────────────────────────────

class MatchSaveBody(BaseModel):
    folder_path: str
    type: str
    id: int
    name: str
    season_num: Optional[int] = None


@app.get("/api/match-history")
def get_match(folder: str = Query(...)):
    return _load_match_history().get(folder) or {}


@app.post("/api/match-history")
def save_match(body: MatchSaveBody):
    h = _load_match_history()
    h[body.folder_path] = body.model_dump(exclude={"folder_path"})
    _save_match_history(h)
    return {"ok": True}


@app.delete("/api/match-history")
def delete_match(folder: str = Query(...)):
    h = _load_match_history()
    h.pop(folder, None)
    _save_match_history(h)
    return {"ok": True}


# ── FFmpeg Validate ────────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    folder_path: str
    files: list[str]


@app.post("/api/remux/validate")
def validate_files(body: ValidateRequest):
    base = Path(body.folder_path)
    results = []
    for fname in body.files:
        src = base / fname
        if not src.exists():
            results.append({"file": fname, "error": "not found"})
            continue
        try:
            fmt_probe = subprocess.run(
                [_ffprobe_exe(), "-v", "error", "-show_entries", "format=format_name,duration,size",
                 "-of", "json", str(src)],
                capture_output=True, text=True, timeout=15,
            )
            fmt = json.loads(fmt_probe.stdout or "{}").get("format", {})
            video_streams = _probe_streams(src, "v")
            audio_streams = _probe_streams(src, "a")
            sub_streams = _probe_streams(src, "s")

            container = Path(fname).suffix.lstrip(".").lower()
            audio_codecs = [s.get("codec") for s in audio_streams]
            video_codec = video_streams[0].get("codec") if video_streams else None
            warnings = []
            if container == "mp4":
                if any(c in (audio_codecs or []) for c in ["dts", "truehd", "eac3"]):
                    warnings.append("MP4 doesn't support DTS/TrueHD/E-AC3 — these tracks will be lost or transcoded")
                if sub_streams:
                    warnings.append("MP4 has limited subtitle support — image-based subs (PGS/VOBSUB) will be dropped")
            if video_codec in ["mpeg2video", "mpeg4"]:
                warnings.append(f"{video_codec} video requires re-encoding to remux to MKV/MP4 (slow)")

            results.append({
                "file": fname,
                "container": container,
                "duration": float(fmt.get("duration") or 0),
                "size": int(fmt.get("size") or 0),
                "video": video_streams,
                "audio": audio_streams,
                "subtitles": sub_streams,
                "warnings": warnings,
            })
        except Exception as e:
            results.append({"file": fname, "error": str(e)})
    return {"files": results}


# ── Updates & Config Export/Import ────────────────────────────────────────────

@app.get("/api/updates/check")
def check_updates():
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/Spinjitsudoom/Matchbox/releases/latest",
            headers={"User-Agent": "Matchbox/1.0"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
        return {"latest_tag": data.get("tag_name"), "url": data.get("html_url"), "name": data.get("name")}
    except Exception:
        return {"latest_tag": None, "url": None, "name": None}


@app.get("/api/config/export")
def export_config():
    content = _CONFIG_FILE.read_text() if _CONFIG_FILE.exists() else "{}"
    return Response(
        content=content, media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=matchbox-config.json"},
    )


class ConfigImportBody(BaseModel):
    data: dict


@app.post("/api/config/import")
def import_config(body: ConfigImportBody):
    allowed = set(_CONFIG_DEFAULTS.keys())
    updates = {k: v for k, v in body.data.items() if k in allowed}
    return cfg.save(updates)


# ── Video stream (for SplitModal player) ──────────────────────────────────────

_VIDEO_MIME = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4',
    '.webm': 'video/webm', '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t',
}

@app.get("/api/probe/video")
def probe_video(path: str):
    """Return fps and duration for a video file via ffprobe."""
    fp = Path(path)
    if not fp.exists():
        raise HTTPException(404, "File not found")
    cmd = [_ffprobe_exe(), "-v", "quiet", "-print_format", "json",
           "-show_streams", "-show_format", str(fp)]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        data = json.loads(result.stdout)
    except Exception:
        return {"fps": 25.0, "duration": 0.0}
    fps = 25.0
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            r = stream.get("r_frame_rate", "25/1")
            try:
                num, den = r.split("/")
                fps = float(num) / float(den)
            except Exception:
                pass
            break
    try:
        duration = float(data.get("format", {}).get("duration", 0))
    except Exception:
        duration = 0.0
    return {"fps": round(fps, 3), "duration": duration}


@app.get("/api/video")
async def stream_video(path: str, request: Request):
    fp = Path(path)
    if not fp.exists() or not fp.is_file():
        raise HTTPException(404, "File not found")
    file_size = fp.stat().st_size
    content_type = _VIDEO_MIME.get(fp.suffix.lower(), 'application/octet-stream')
    CHUNK = 1 << 20  # 1 MB

    range_header = request.headers.get("range", "")
    m = re.match(r'bytes=(\d+)-(\d*)', range_header)
    if m:
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else min(start + CHUNK - 1, file_size - 1)
        end = min(end, file_size - 1)
        length = end - start + 1

        def _iter():
            with open(fp, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    data = f.read(min(CHUNK, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(_iter(), status_code=206, media_type=content_type, headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
            "Accept-Ranges": "bytes",
        })

    def _iter_full():
        with open(fp, "rb") as f:
            while True:
                data = f.read(CHUNK)
                if not data:
                    break
                yield data

    return StreamingResponse(_iter_full(), media_type=content_type, headers={
        "Content-Length": str(file_size),
        "Accept-Ranges": "bytes",
    })


# ── Split File ─────────────────────────────────────────────────────────────────

class SplitRequest(BaseModel):
    folder_path: str
    filename: str
    splits: list[str]       # HH:MM:SS.mmm timestamps marking start of segments 2, 3, …
    output_names: list[str] # one name per segment (len = len(splits) + 1)
    delete_original: bool = False


@app.post("/api/split")
def split_file(body: SplitRequest):
    if len(body.splits) + 1 != len(body.output_names):
        raise HTTPException(400, "output_names must have exactly one more entry than splits")
    base = Path(body.folder_path)
    src = base / body.filename
    if not src.exists():
        raise HTTPException(400, "File not found")

    def _hms_to_secs(hms: str) -> float:
        parts = hms.split(':')
        try:
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        except Exception:
            return 0.0

    def generate():
        total_segs = len(body.output_names)
        starts = ["00:00:00"] + list(body.splits)
        ends: list[Optional[str]] = list(body.splits) + [None]
        all_ok = True

        # Detect source codec and total duration upfront (needed for all modes)
        try:
            v_streams = _probe_streams(src, "v")
            src_codec = v_streams[0]["codec"] if v_streams else "h264"
        except Exception:
            src_codec = "h264"
        enc_args = (
            ["-c:v", "libx265", "-crf", "18", "-preset", "fast"]
            if src_codec == "hevc"
            else ["-c:v", "libx264", "-crf", "18", "-preset", "fast"]
        )
        dur_r = subprocess.run(
            [_ffprobe_exe(), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(src)],
            capture_output=True, text=True, timeout=15,
        )
        try:
            src_duration = float(dur_r.stdout.strip())
        except (ValueError, AttributeError):
            src_duration = 0.0

        for i, (start, end, out_name) in enumerate(zip(starts, ends, body.output_names)):
            yield f"data: {json.dumps({'segment': i+1, 'total': total_segs, 'status': 'running', 'file': out_name})}\n\n"
            start_secs = _hms_to_secs(start)
            end_secs   = _hms_to_secs(end) if end else src_duration
            seg_dur    = max(0.0, end_secs - start_secs)
            is_first   = start_secs < 0.01
            is_last    = end is None

            # Probe the nearest keyframes to each cut boundary
            kf_start = 0.0 if is_first else _probe_kf_after(src, start_secs)
            kf_end   = end_secs if is_last else _probe_kf_before(src, end_secs)

            need_head   = not is_first and (kf_start - start_secs) > 0.02
            need_tail   = not is_last  and (end_secs - kf_end)    > 0.02
            need_middle = kf_start < kf_end - 0.02

            ok = True
            err_msg = ""
            out_path = base / out_name

            if not need_head and not need_tail:
                # Both boundaries on (or within 0.02 s of) keyframes → stream copy.
                # Seek to kf_start, not start_secs: input-side -ss on a non-keyframe
                # timestamp snaps backward to the previous keyframe, adding unwanted
                # footage. kf_start is itself a keyframe so the seek is exact.
                seek_to = 0.0 if is_first else kf_start
                cut_at  = src_duration if is_last else kf_end
                cmd = [_ffmpeg_exe(), "-y"]
                if seek_to > 0.01:
                    cmd += ["-ss", f"{seek_to:.6f}"]
                cmd += ["-i", str(src)]
                if not is_last:
                    cmd += ["-t", f"{cut_at - seek_to:.6f}"]
                cmd += ["-c", "copy", str(out_path)]
                try:
                    r = subprocess.run(cmd, capture_output=True, timeout=3600)
                    if r.returncode != 0:
                        err_msg = r.stderr.decode(errors="replace")[-300:]
                        ok = False
                except Exception as e:
                    ok = False; err_msg = str(e)

            elif not need_middle:
                # Segment too short for a split middle → full re-encode
                cmd = [_ffmpeg_exe(), "-y"]
                if start_secs > 0.01:
                    cmd += ["-ss", f"{start_secs:.6f}"]
                cmd += ["-i", str(src)]
                if end:
                    cmd += ["-t", f"{seg_dur:.6f}"]
                cmd += enc_args + ["-c:a", "copy", "-progress", "pipe:1", str(out_path)]
                try:
                    with tempfile.TemporaryFile() as ef:
                        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=ef)
                        for raw in proc.stdout:  # type: ignore[union-attr]
                            line = raw.decode(errors="replace").strip()
                            if line.startswith("out_time_us=") and seg_dur > 0:
                                try:
                                    pct = min(99, int(int(line.split("=")[1]) / (seg_dur * 1_000_000) * 100))
                                    yield f"data: {json.dumps({'segment': i+1, 'total': total_segs, 'status': 'running', 'progress': pct, 'file': out_name})}\n\n"
                                except (ValueError, ZeroDivisionError):
                                    pass
                        try:
                            proc.wait(timeout=3600)
                        except subprocess.TimeoutExpired:
                            proc.kill(); proc.wait()
                        if proc.returncode != 0:
                            ef.seek(0)
                            err_msg = ef.read().decode(errors="replace")[-300:]
                            ok = False
                except Exception as e:
                    ok = False; err_msg = str(e)

            else:
                # Smart split: re-encode only the non-keyframe-aligned boundary
                # segments; stream-copy the keyframe-aligned middle bulk.
                tmp_dir = Path(tempfile.mkdtemp())
                try:
                    parts: list[str] = []

                    # A) Head: re-encode [start_secs → kf_start]
                    if need_head:
                        head_dur = kf_start - start_secs
                        head_path = str(tmp_dir / "head.mkv")
                        cmd = ([_ffmpeg_exe(), "-y", "-ss", f"{start_secs:.6f}",
                                "-i", str(src), "-t", f"{head_dur:.6f}"]
                               + enc_args + ["-c:a", "copy", "-progress", "pipe:1", head_path])
                        with tempfile.TemporaryFile() as ef:
                            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=ef)
                            for raw in proc.stdout:  # type: ignore[union-attr]
                                line = raw.decode(errors="replace").strip()
                                if line.startswith("out_time_us=") and head_dur > 0:
                                    try:
                                        pct = min(19, int(int(line.split("=")[1]) / (head_dur * 1_000_000) * 20))
                                        yield f"data: {json.dumps({'segment': i+1, 'total': total_segs, 'status': 'running', 'progress': pct, 'file': out_name})}\n\n"
                                    except (ValueError, ZeroDivisionError):
                                        pass
                            try:
                                proc.wait(timeout=3600)
                            except subprocess.TimeoutExpired:
                                proc.kill(); proc.wait()
                            if proc.returncode != 0:
                                ef.seek(0)
                                err_msg = ef.read().decode(errors="replace")[-300:]
                                ok = False
                        if ok:
                            parts.append(head_path)

                    if ok:
                        yield f"data: {json.dumps({'segment': i+1, 'total': total_segs, 'status': 'running', 'progress': 20, 'file': out_name})}\n\n"

                    # B) Middle: stream copy [kf_start → kf_end]
                    if ok:
                        mid_dur  = kf_end - kf_start
                        mid_path = str(tmp_dir / "middle.mkv")
                        cmd = [_ffmpeg_exe(), "-y", "-ss", f"{kf_start:.6f}",
                               "-i", str(src), "-t", f"{mid_dur:.6f}", "-c", "copy", mid_path]
                        r = subprocess.run(cmd, capture_output=True, timeout=3600)
                        if r.returncode != 0:
                            err_msg = r.stderr.decode(errors="replace")[-300:]
                            ok = False
                        else:
                            parts.append(mid_path)

                    if ok:
                        yield f"data: {json.dumps({'segment': i+1, 'total': total_segs, 'status': 'running', 'progress': 80, 'file': out_name})}\n\n"

                    # C) Tail: re-encode [kf_end → end_secs]
                    if ok and need_tail:
                        tail_dur  = end_secs - kf_end
                        tail_path = str(tmp_dir / "tail.mkv")
                        cmd = ([_ffmpeg_exe(), "-y", "-ss", f"{kf_end:.6f}",
                                "-i", str(src), "-t", f"{tail_dur:.6f}"]
                               + enc_args + ["-c:a", "copy", "-progress", "pipe:1", tail_path])
                        with tempfile.TemporaryFile() as ef:
                            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=ef)
                            for raw in proc.stdout:  # type: ignore[union-attr]
                                line = raw.decode(errors="replace").strip()
                                if line.startswith("out_time_us=") and tail_dur > 0:
                                    try:
                                        pct = 80 + min(19, int(int(line.split("=")[1]) / (tail_dur * 1_000_000) * 20))
                                        yield f"data: {json.dumps({'segment': i+1, 'total': total_segs, 'status': 'running', 'progress': pct, 'file': out_name})}\n\n"
                                    except (ValueError, ZeroDivisionError):
                                        pass
                            try:
                                proc.wait(timeout=3600)
                            except subprocess.TimeoutExpired:
                                proc.kill(); proc.wait()
                            if proc.returncode != 0:
                                ef.seek(0)
                                err_msg = ef.read().decode(errors="replace")[-300:]
                                ok = False
                        if ok:
                            parts.append(tail_path)

                    # D) Concat all parts into the final output file
                    if ok:
                        if len(parts) == 1:
                            shutil.move(parts[0], str(out_path))
                        else:
                            concat_txt = str(tmp_dir / "concat.txt")
                            with open(concat_txt, "w") as f:
                                for p in parts:
                                    f.write(f"file '{p}'\n")
                            cmd = [_ffmpeg_exe(), "-y", "-f", "concat", "-safe", "0",
                                   "-i", concat_txt, "-c", "copy", str(out_path)]
                            r = subprocess.run(cmd, capture_output=True, timeout=3600)
                            if r.returncode != 0:
                                err_msg = r.stderr.decode(errors="replace")[-300:]
                                ok = False

                except Exception as e:
                    ok = False; err_msg = str(e)
                finally:
                    shutil.rmtree(str(tmp_dir), ignore_errors=True)

            if ok:
                yield f"data: {json.dumps({'segment': i+1, 'total': total_segs, 'status': 'done', 'file': out_name})}\n\n"
            else:
                all_ok = False
                yield f"data: {json.dumps({'segment': i+1, 'total': total_segs, 'status': 'error', 'file': out_name, 'error': err_msg})}\n\n"

        if body.delete_original and all_ok:
            try:
                src.unlink()
                yield f"data: {json.dumps({'status': 'deleted_original'})}\n\n"
            except Exception:
                pass
        yield f"data: {json.dumps({'status': 'complete', 'total': total_segs})}\n\n"

    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Static frontend ───────────────────────────────────────────────────────────

_frontend = Path(__file__).parent / "frontend" / "dist"
if _frontend.exists():
    app.mount("/assets", StaticFiles(directory=str(_frontend / "assets")), name="assets")

    @app.get("/")
    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str = ""):
        index = _frontend / "index.html"
        return FileResponse(str(index))
