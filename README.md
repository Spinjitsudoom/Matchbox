# Matchbox

A desktop app for renaming, organising, splitting, and generating subtitles for your TV show and movie library — powered by TMDB metadata and faster-whisper.

![Version](https://img.shields.io/badge/version-2.1.0-blue)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## What's New in v2.1.0

### Movie Library Organizer
Reorganise your entire movie collection in one click with six built-in schemes — all with a live preview before anything moves:

| Scheme | Description |
|---|---|
| **Flat** | All files in one folder |
| **A – Z** | One subfolder per starting letter (articles like "The" are ignored) |
| **Year** | One subfolder per release year — extracted directly from the filename, no TMDB needed |
| **Genre** | Folders by genre (Action, Animation, …) using TMDB metadata |
| **Studio** | Folders by primary production company using TMDB metadata |
| **Franchise** | Series grouped together (e.g. Iron Man, Thor, Avengers); standalone films sit at the root |

Numbered prefixes like `01 - Iron Man - 2009.mp4` are handled correctly throughout — the number is stripped before searching TMDB and before picking a sort letter.

### Organize Undo
Changed your mind? The last organize operation can be reversed in a single click from the Organize dialog. Matchbox records every move and restores all files to exactly where they were.

### Movie Match History
Clicking a movie file and matching it to a TMDB entry is now remembered across restarts. Re-open the app, click the same file, and the TMDB match is restored automatically.

### Library Sort (Movie Mode)
Four sort options in the movie library panel:
- **Name** — alphabetical
- **Year** — by release year extracted from the filename
- **Count** — by number of files in each folder
- **Franchise** — groups sequels together, standalone films listed below

### Bug Fixes
- Titles with lowercase articles (`of`, `the`, `a`) are no longer wrongly capitalised when sanitising TMDB names (e.g. "Avatar: The Way **of** Water" stayed correct)
- Numbered prefixes (`01 - `, `18 -`) are stripped before every TMDB search, filename sort, and A–Z folder assignment
- Switching to a different movie file now immediately clears the previous TMDB match so the wrong rename is never shown

---

## Previous Release — v2.0.0

### Frame-Accurate Video Splitting
Matchbox uses a smart split strategy:
- **Stream copy** when the cut lands on a keyframe — instant, lossless
- **Smart re-encode** of only the non-aligned head/tail segments when the cut falls between keyframes

### Auto-Naming Split Segments
When splitting a file named `09 - Part A - Part B.mkv`, output segments are named automatically — no manual renaming needed.

### Separate TV & Movie Library Paths
Configure independent root folders for your TV and movie libraries.

### First-Run Setup Wizard
A guided wizard collects your TMDB API key and library paths on first launch.

### Undo Renames
Every rename operation is tracked and reversible in one click.

### Windows Builds
- **Installer** — produced with Inno Setup: Start Menu entry, optional desktop shortcut, clean uninstaller
- **Portable** — a self-contained zip that runs without installation

---

## Features

- **Library browser** — browse TV shows by season or movies by file, with separate root paths for each
- **TMDB metadata** — search and match TV shows and movies against The Movie Database; matches remembered across restarts
- **Smart renaming** — rename episode and movie files using TMDB titles
  - Numeric mode, title-match mode, configurable naming template (`{e:02d}{sep}{title}`, `{title} ({year})`, etc.)
  - Undo support for the entire last rename batch
- **Movie library organizer** — reorganise your collection by Flat, A–Z, Year, Genre, Studio, or Franchise with live preview and one-click undo
- **Library sort** (movie mode) — sort by Name, Year, file Count, or Franchise grouping
- **Frame-accurate file splitting** — split any video at an exact frame with lossless stream copy where possible
  - Auto-names segments from the source filename; multi-file navigation without closing the modal
- **Subtitle generation** — generate `.srt` files locally using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (offline after model download)
  - VAD filter, configurable model size (tiny → large), beam size, language, and initial prompt; per-file audio track selection
- **Remux** — batch convert video files between formats using FFmpeg (stream copy, lossless)
  - Set default audio and subtitle tracks; pre-flight validation with codec and container warnings
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
| macOS (DMG) | `Matchbox-x.x.x.dmg` | Apple Silicon; unsigned — see note below |
| macOS (Zip) | `Matchbox-x.x.x-arm64-mac.zip` | Extract `Matchbox.app` and run |

> **macOS unsigned build:** The app is not notarised. On first launch macOS Gatekeeper will block it. To open it: right-click the app → **Open** → **Open**, or run `xattr -cr Matchbox.app` in a terminal before launching.

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
config.json           # API key, library paths, preferences
.rename_history.json  # Rename undo history
organize_history.json # Organize undo history (last library reorganization)
presets.json          # Saved remux / subtitle presets
match_history.json    # Remembered TMDB matches per file/folder
backend.log           # Backend process log
bin/                  # Bundled ffmpeg/ffprobe (if downloaded in-app)
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

### macOS distributable

macOS builds run automatically via GitHub Actions on any `v*` tag push (Apple Silicon / arm64):

1. Builds the Python backend with PyInstaller
2. Builds the React frontend with Vite
3. Packages the Electron app as a DMG and zip
4. Uploads to the GitHub Release

The build is **unsigned**. See the Gatekeeper note in the Download section.

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
