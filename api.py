"""FastAPI backend for Media Manager TMDB."""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Optional

from thefuzz import process, fuzz

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tmdb_engine import TMDBEngine

app = FastAPI(title="Media Manager TMDB")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def _data_dir() -> Path:
    d = Path.home() / "Documents" / "Media Manager"
    d.mkdir(parents=True, exist_ok=True)
    return d

_DATA_DIR = _data_dir()
_CONFIG_FILE = _DATA_DIR / "config.json"
_CONFIG_DEFAULTS: dict = {"api_key": "", "path": "/", "pattern": " - ", "theme": "Slate"}


class ConfigManager:
    def load(self) -> dict:
        data = dict(_CONFIG_DEFAULTS)
        if _CONFIG_FILE.exists():
            try:
                data.update(json.loads(_CONFIG_FILE.read_text()))
            except Exception:
                pass
        return data

    def save(self, updates: dict) -> dict:
        data = self.load()
        data.update(updates)
        _CONFIG_FILE.write_text(json.dumps(data, indent=2))
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


@app.post("/api/config")
def save_config(body: ConfigUpdate):
    global _engine
    _engine = None
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    return cfg.save(updates)


# ── Library ───────────────────────────────────────────────────────────────────

@app.get("/api/library")
def list_library():
    config = cfg.load()
    base = Path(config.get("path", "/"))
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
    subs = [d for d in sorted(p.iterdir()) if d.is_dir()]
    result = []
    for d in subs:
        files = [f for f in d.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXTS]
        result.append({"name": d.name, "path": str(d), "file_count": len(files)})
    # also include files directly in the folder
    direct = [f for f in p.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXTS]
    if direct:
        result.insert(0, {"name": p.name, "path": str(p), "file_count": len(direct)})
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
    return engine().search_movies(q)


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

@app.get("/api/image")
def proxy_image(path: str = Query(...), size: str = Query("w342")):
    url = f"{TMDB_IMG_BASE}/{size}{path}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MediaManager/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
            ct = resp.headers.get("Content-Type", "image/jpeg")
        return Response(content=data, media_type=ct)
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
    eng = engine()

    base = Path(body.season_path)
    local_files = sorted([
        f for f in os.listdir(body.season_path)
        if os.path.isfile(base / f) and Path(f).suffix.lower() in VIDEO_EXTS
    ])

    # ── Movie mode ────────────────────────────────────────────────────────────
    if body.mode == "movie":
        if not body.movie_id:
            raise HTTPException(400, "movie_id required for movie mode")
        details = eng.get_movie_details(body.movie_id)
        title = eng._sanitize_title(details.get("title", "Unknown"))
        year = details.get("release_date", "")[:4]
        label = f"{title} - {year}" if year else title
        results = []
        for i, f in enumerate(local_files):
            ext = Path(f).suffix
            if len(local_files) == 1:
                new_file = f"{label}{ext}"
            else:
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
                display_num = str(ep["num"] + body.f_offset).zfill(2)
                new_file = f"{display_num} - {clean_title}{ext}"
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
                display_num = str(ep_num + body.f_offset).zfill(2)
                new_file = f"{display_num}{pattern}{clean_title}{Path(old_file).suffix}"
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

    for pair in body.pairs:
        old_path = base / pair["old"]
        new_path = base / pair["new"]
        if old_path.name == new_path.name:
            continue
        if not old_path.exists():
            errors.append(f"Not found: {pair['old']}")
            continue
        if new_path.exists():
            errors.append(f"Already exists: {pair['new']}")
            continue
        try:
            old_path.rename(new_path)
            history_batch.append((str(new_path), str(old_path)))
            done.append(pair["new"])
        except Exception as e:
            errors.append(f"{pair['old']}: {e}")

    _rename_history.extend(history_batch)
    _save_history(_rename_history)
    return {"renamed": done, "errors": errors, "can_undo": bool(history_batch)}


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


# ── Remux ─────────────────────────────────────────────────────────────────────

class RemuxRequest(BaseModel):
    folder_path: str
    files: list[str]
    target_format: str       # "mkv", "mp4", "m4v", "avi"
    delete_original: bool = False


@app.get("/api/remux/check")
def check_ffmpeg():
    try:
        r = subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        return {"available": r.returncode == 0}
    except Exception:
        return {"available": False}


@app.post("/api/remux")
def start_remux(body: RemuxRequest):
    base = Path(body.folder_path)
    if not base.exists():
        raise HTTPException(400, "Folder not found")
    target_ext = body.target_format.lstrip(".").lower()

    def generate():
        total = len(body.files)
        for idx, fname in enumerate(body.files):
            src = base / fname
            src_ext = Path(fname).suffix.lstrip(".").lower()

            yield f"data: {json.dumps({'file': fname, 'status': 'running', 'done': idx, 'total': total})}\n\n"

            if src_ext == target_ext:
                yield f"data: {json.dumps({'file': fname, 'status': 'skipped', 'reason': 'same format', 'done': idx + 1, 'total': total})}\n\n"
                continue

            if not src.exists():
                yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': 'File not found', 'done': idx + 1, 'total': total})}\n\n"
                continue

            dst_name = Path(fname).stem + "." + target_ext
            dst = base / dst_name

            if target_ext == "mkv":
                cmd = ["ffmpeg", "-i", str(src), "-map", "0", "-c", "copy", str(dst), "-y"]
            else:
                cmd = ["ffmpeg", "-i", str(src), "-c:v", "copy", "-c:a", "copy", str(dst), "-y"]

            try:
                result = subprocess.run(cmd, capture_output=True, timeout=3600)
                if result.returncode == 0:
                    if body.delete_original:
                        src.unlink(missing_ok=True)
                    yield f"data: {json.dumps({'file': fname, 'out': dst_name, 'status': 'done', 'done': idx + 1, 'total': total})}\n\n"
                else:
                    stderr = result.stderr.decode(errors="replace")[-300:]
                    if dst.exists():
                        dst.unlink(missing_ok=True)
                    yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': stderr, 'done': idx + 1, 'total': total})}\n\n"
            except subprocess.TimeoutExpired:
                yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': 'Timed out', 'done': idx + 1, 'total': total})}\n\n"
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

            try:
                if model is None:
                    yield f"data: {json.dumps({'file': fname, 'status': 'loading_model', 'model': body.model, 'done': idx, 'total': total})}\n\n"
                    model = WhisperModel(body.model, device="cpu", compute_type="int8")

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

                segments, info = model.transcribe(str(src), **kwargs)

                srt_name = src.stem + ".srt"
                srt_path = base / srt_name
                with open(srt_path, "w", encoding="utf-8") as f:
                    for i, seg in enumerate(segments, 1):
                        f.write(f"{i}\n{_fmt_srt_time(seg.start)} --> {_fmt_srt_time(seg.end)}\n{seg.text.strip()}\n\n")

                yield f"data: {json.dumps({'file': fname, 'out': srt_name, 'status': 'done', 'language': info.language, 'done': idx + 1, 'total': total})}\n\n"

            except Exception as exc:
                yield f"data: {json.dumps({'file': fname, 'status': 'error', 'error': str(exc)[:200], 'done': idx + 1, 'total': total})}\n\n"

        yield f"data: {json.dumps({'status': 'complete', 'total': total})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
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
