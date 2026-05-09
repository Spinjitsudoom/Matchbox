#!/usr/bin/env bash
# Media Manager TMDB — full distribution build
# Outputs: AppImage + Flatpak (Windows is built via GitHub Actions)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> [1/3] Building Python backend with PyInstaller..."
uv run pyinstaller backend.spec --distpath dist/backend --workpath /tmp/pyinstaller-work --noconfirm
echo "    Backend binary: dist/backend/backend_main/"

echo ""
echo "==> [2/3] Building frontend..."
cd "$SCRIPT_DIR/frontend"
npm run build

echo ""
echo "==> [3/3] Packaging Linux (AppImage + Flatpak)..."
mkdir -p "$SCRIPT_DIR/.tmp"
TMPDIR="$SCRIPT_DIR/.tmp" ./node_modules/.bin/electron-builder --linux

echo ""
echo "==> Moving builds to 'complete builds/'..."
mkdir -p "$SCRIPT_DIR/complete builds"
find /tmp/electron-output -maxdepth 1 \( -name "*.AppImage" -o -name "*.flatpak" \) \
  -exec mv {} "$SCRIPT_DIR/complete builds/" \;

echo "==> Done!"
ls -lh "$SCRIPT_DIR/complete builds/"
