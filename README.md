# TMDB Media Manager

A desktop media manager for renaming, organising, and generating subtitles for your TV show and movie library — powered by TMDB metadata and faster-whisper.

![Platform](https://img.shields.io/badge/platform-Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Library browser** — browse your media library organised by show and season
- **TMDB metadata** — search and match TV shows and movies against The Movie Database
- **Smart renaming** — rename episode files using TMDB titles with numeric or title-match modes, with undo support
- **Movie support** — rename movie files with title and year
- **Subtitle generation** — generate `.srt` subtitle files locally using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (no internet required after model download)
  - VAD filter to remove hallucinations
  - Configurable model size (tiny → medium), beam size, and initial prompt
- **Remux** — batch convert video files between formats using FFmpeg (stream copy, lossless)
- **Themes** — 9 built-in colour themes
- **Portable** — ships as a self-contained AppImage (Linux) or NSIS installer (Windows)

---

## Download

Head to the [Releases](https://github.com/Spinjitsudoom/TMDB-Media-Manager/releases) page for the latest builds:

| Platform | File |
|---|---|
| Linux | `Media.Manager-x.x.x.AppImage` |
| Windows | `Media.Manager-Setup-x.x.x.exe` |

---

## Setup

### 1. TMDB API Key

The app requires a free TMDB API key to search for show/movie metadata.

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/)
2. Go to **Settings → API** and generate a key
3. Paste it into **Settings** inside the app

### 2. Media Library Path

Set the root folder of your media library in **Settings**. The app expects the following structure:

```
/your/media/root/
  Show Name/
    Season 01/
      episode files...
    Season 02/
  Another Show/
  Movie Name/
```

### 3. Subtitle Generation (optional)

Subtitle generation uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and runs entirely offline after the first model download. Models are downloaded automatically on first use and cached locally.

FFmpeg is required for the Remux feature — install it via your package manager (`sudo apt install ffmpeg` / `sudo dnf install ffmpeg`).

---

## Config & Data

When running as a packaged app, all user data is stored in:

```
~/Documents/Media Manager/
  config.json          # API key, library path, preferences
  .rename_history.json # Undo history
  backend.log          # Backend process log
```

---

## Building from Source

### Requirements

- Python 3.14+ with [uv](https://github.com/astral-sh/uv)
- Node.js 18+
- `flatpak-builder` (for Flatpak target)

### Build

```bash
# Install Python dependencies
uv sync

# Install Node dependencies
cd frontend && npm install && cd ..

# Build AppImage + Flatpak
bash build.sh
```

Windows builds are produced via GitHub Actions on release.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | Electron + React + TypeScript + Tailwind CSS |
| Backend | Python + FastAPI + uvicorn |
| Metadata | TMDB API (via tmdbv3api) |
| Subtitles | faster-whisper (CTranslate2) |
| Packaging | PyInstaller + electron-builder |

---

## License

MIT — see [LICENSE](LICENSE)
