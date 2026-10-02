#!/usr/bin/env bash
# Grabbit installer for macOS.
# Run from the grabbit-premiere folder:   bash install/install-mac.sh
# Copies the panel into ~/Library/Application Support/Adobe/CEP/extensions,
# enables unsigned extensions, and fetches yt-dlp, ffmpeg/ffprobe and deno into bin/.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/Grabbit"
BIN="$DEST/bin"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Installing Grabbit to $DEST"
mkdir -p "$DEST"
for item in CSXS css js jsx bin index.html .debug; do
  cp -R "$SRC/$item" "$DEST/"
done

# Unsigned extensions only load with PlayerDebugMode on (one domain per CEP version).
for v in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
echo "Enabled PlayerDebugMode for CSXS 9-13"

echo "Downloading yt-dlp..."
curl -fL --progress-bar -o "$BIN/yt-dlp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
chmod +x "$BIN/yt-dlp"

if command -v brew >/dev/null 2>&1; then
  echo "Installing ffmpeg and deno with Homebrew (Grabbit finds them in /opt/homebrew/bin)..."
  brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg
  brew list deno   >/dev/null 2>&1 || brew install deno
else
  echo "Homebrew not found; downloading static ffmpeg/ffprobe from evermeet.cx..."
  for tool in ffmpeg ffprobe; do
    curl -fL --progress-bar -o "$TMP/$tool.zip" "https://evermeet.cx/ffmpeg/getrelease/$tool/zip"
    unzip -o -q "$TMP/$tool.zip" -d "$BIN"
    chmod +x "$BIN/$tool"
  done
  echo "Downloading deno..."
  arch="$(uname -m)"; [ "$arch" = "arm64" ] && target=aarch64-apple-darwin || target=x86_64-apple-darwin
  curl -fL --progress-bar -o "$TMP/deno.zip" "https://github.com/denoland/deno/releases/latest/download/deno-$target.zip"
  unzip -o -q "$TMP/deno.zip" -d "$BIN"
  chmod +x "$BIN/deno"
fi

# Downloaded binaries are quarantined by Gatekeeper; clear that so Premiere can run them.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo
echo "Done. Restart Premiere Pro, then open Window > Extensions > Grabbit."
