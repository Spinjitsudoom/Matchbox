# AGENTS.md — AI agent quick guide

Purpose: concise, actionable guidance for AI coding agents working on this repository.

**Quick Facts**
- **Language:** Python 3.8+
- **Run:** `python media_dashboard.py` (launches the Tkinter GUI)
- **Deps:** `pip install -r requirements.txt`
- **Config:** `config.json` at repo root (contains `api_key`, `path`, `pattern`, `theme`)

**Setup (local developer)**
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python media_dashboard.py
```

**Key files**
- [media_dashboard.py](media_dashboard.py) — Main app / UI / control flow
- [tmdb_engine.py](tmdb_engine.py) — TMDb API integration and matching logic
- [settings_manager.py](settings_manager.py) — Read/write `config.json` and settings UI
- [themes.py](themes.py) — Theme definitions and application helpers
- [config.json](config.json) — Runtime settings (DO NOT commit secrets)
- [requirements.txt](requirements.txt) — Python dependencies
- [Documentation](Documentation) — Full project docs and architecture notes

**Agent Hints (how to get productive quickly)**
- Start by reading `media_dashboard.py`, then `tmdb_engine.py`, then `settings_manager.py` to understand control flow.
- Check `config.json` to learn what settings the app expects (API key, media root path).
- There are no automated tests or CI; run the app interactively for smoke checks.
- For fuzzy matching behavior, inspect `thefuzz` usage in `tmdb_engine.py` and confirm `python-Levenshtein` is installed.

**Common pitfalls**
- API keys are sensitive: do not paste live keys into PRs or issue descriptions. Prefer using the app Settings dialog or local `config.json` (exclude via .gitignore if needed).
- `config.json` is read relative to the working directory — run scripts from the repo root to avoid path issues.
- If fuzzy matching is slow, ensure `python-Levenshtein` is installed to accelerate `thefuzz`.

**Suggested next agent customizations**
- `/create-skill setup-and-run` — a short skill that runs environment setup and launches the app for manual testing.
- `/create-prompt add-tmdb-key` — a guided prompt to help the user securely add/update the TMDb API key in `config.json` or via the Settings UI.

For detailed architecture and feature docs, see the [Documentation](Documentation) folder.

**Coding Guidelines (CLAUDE)**
- A concise set of behavioral rules for agent edits is included in [CLAUDE.md](CLAUDE.md).
- Key rules: state assumptions, prefer minimal/surgical changes, and define verifiable success criteria.
- Agents should consult `CLAUDE.md` before making non-trivial edits.
