# Matchbox

A desktop app for renaming, organising, splitting, and generating subtitles for your TV show and movie library — powered by TMDB metadata and faster-whisper.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## What's New in v2.0.0

### Frame-Accurate Video Splitting
Split episodes or movies at any point with frame accuracy. Matchbox uses a smart split strategy:
- **Stream copy** when the cut lands on a keyframe — instant, lossless
- **Smart re-encode** of only the non-aligned head/tail segments when the cut falls between keyframes, stream-copying the aligned bulk — preserves quality while keeping the cut frame-exact

### Auto-Naming Split Segments
When splitting a file named `09 - Part A - Part B.mkv`, Matchbox automatically names the output segments by splitting on ` - ` from the right — no manual renaming needed.

### Separate TV & Movie Library Paths
Configure independent root folders for your TV and movie libraries, with the media type toggle switching instantly between them.

### First-Run Setup Wizard
On first launch, a guided setup wizard collects your TMDB API key and library paths so the app is ready to use immediately.

### Undo Renames
Every rename operation is tracked. Undo restores your entire last batch of renames in one click.

### Full Library Refresh
The refresh button now fully reloads the library — clearing the season folder cache and re-fetching the expanded show's seasons — so any files added, removed, or renamed on disk are reflected instantly.

### Version in Titlebar
The current app version is always displayed in the titlebar, pulled directly from the build — no more stale version strings.

### Windows Builds
- **Installer** — produced with Inno Setup: Start Menu entry, optional desktop shortcut, clean uninstaller
- **Portable** — a self-contained zip that runs without installation

---

## Features

- **Library browser** — browse your media library organised by show and season, with separate TV and movie root paths
- **TMDB metadata** — search and match TV shows and movies against The Movie Database
- **Smart renaming** — rename episode files using TMDB titles with numeric or title-match modes
  - Configurable naming template (`{e:02d} - {title}`, etc.)
  - Undo support for the entire last rename batch
- **Movie support** — rename movie files with title and year
- **Frame-accurate file splitting** — split any video at an exact frame with lossless stream copy where possible
  - Auto-names segments from the source filename using the ` - ` separator
  - Multi-file navigation — step through a whole season without closing the modal
- **Subtitle generation** — generate `.srt` files locally using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (offline after model download)
  - VAD filter, configurable model size (tiny → large), beam size, language, and initial prompt
  - Per-file audio track selection
- **Remux** — batch convert video files between formats using FFmpeg (stream copy, lossless)
  - Set default audio and subtitle tracks
  - Pre-flight validation with codec and container warnings
- **Themes** — 9 built-in colour themes + 3 fully customisable themes
- **Portable** — AppImage, Flatpak (Linux), Inno Setup installer, or portable zip (Windows)

---

## Download

Head to the [Releases](https://github.com/Spinjitsudoom/Matchbox/releases) page for the latest builds:

| Platform | File | Notes |
|---|---|---|
| Linux (AppImage) | `Matchbox-x.x.x.AppImage` | `chmod +x` then run |
| Linux (Flatpak) | `Matchbox-x.x.x-x86_64.flatpak` | `flatpak install` |
| Windows (Installer) | `Matchbox-Setup-x.x.x.exe` | Inno Setup, adds Start Menu entry |
| Windows (Portable) | `Matchbox-x.x.x-portable-win.zip` | Extract and run, no install needed |

---

## Setup

### 1. TMDB API Key

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/)
2. Go to **Settings → API** and generate a key
3. Paste it into the first-run wizard or **Settings** inside the app

### 2. Media Library Paths

Set your TV and movie root folders in the first-run wizard or **Settings**. The app expects:

```
/your/tv/root/
  Show Name/
    Season 01/
      episode files...

/your/movies/root/
  Movie Name (2024)/
    movie file...
```

### 3. Subtitle Generation (optional)

faster-whisper runs entirely offline after the first model download. Models are cached locally and downloaded automatically on first use.

### 4. FFmpeg

Required for remuxing and file splitting. If it isn't on your system, the app offers a one-click download from Settings.

---

## Config & Data

All user data is stored in `~/Documents/Matchbox/`:

```
config.json          # API key, library paths, preferences
.rename_history.json # Undo history
presets.json         # Saved remux / subtitle presets
match_history.json   # Remembered TMDB matches per folder
backend.log          # Backend process log
bin/                 # Bundled ffmpeg/ffprobe (if downloaded in-app)
```

---

## Building from Source

### Requirements

- Python 3.14+ with [uv](https://github.com/astral-sh/uv)
- Node.js 20+
- `flatpak-builder` (Linux Flatpak target only)
- Inno Setup 6 (Windows installer — CI only)

### Dev mode

```bash
./run.sh
```

Starts the FastAPI backend and launches Electron. The backend is killed cleanly on exit.

### Linux distributable

```bash
uv sync
cd frontend && npm install && cd ..
bash build.sh
```

Produces `Matchbox-x.x.x.AppImage` and `Matchbox-x.x.x-x86_64.flatpak` in `complete builds/`.

### Windows distributable

Windows builds run automatically via GitHub Actions on any `v*` tag push:

1. Builds the Python backend with PyInstaller
2. Builds the React frontend with Vite
3. Packages the Electron app (unpacked)
4. Produces an Inno Setup installer (`Matchbox-Setup-x.x.x.exe`)
5. Zips the unpacked app as a portable build (`Matchbox-x.x.x-portable-win.zip`)

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | Electron + React + TypeScript + Tailwind CSS |
| Backend | Python + FastAPI + uvicorn |
| Metadata | TMDB API |
| Subtitles | faster-whisper (CTranslate2) |
| Video | FFmpeg / ffprobe |
| Packaging | PyInstaller + electron-builder + Inno Setup |

---

## License

MIT — see [LICENSE](LICENSE)
