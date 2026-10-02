#!/usr/bin/env bash
# Popline installer for macOS:   bash install/install-mac.sh
# Copies the panel into ~/Library/Application Support/Adobe/CEP/extensions/Popline, enables unsigned
# extensions, installs ffmpeg + whisper.cpp (Homebrew) and downloads a speech model.
set -euo pipefail
MODEL="${MODEL:-base}"   # tiny | base | small | large-v3-turbo-q5_0

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/Popline"
BIN="$DEST/bin"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "Installing Popline to $DEST"
mkdir -p "$DEST"
for item in CSXS css js jsx fonts bin models index.html .debug; do cp -R "$SRC/$item" "$DEST/"; done
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
echo "Enabled PlayerDebugMode for CSXS 9-13"

if command -v brew >/dev/null 2>&1; then
  echo "Installing ffmpeg and whisper.cpp with Homebrew..."
  brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg
  brew list whisper-cpp >/dev/null 2>&1 || brew install whisper-cpp
else
  echo "Homebrew not found. whisper.cpp needs Homebrew (https://brew.sh) — or use the OpenAI engine in the panel."
fi

# Captions are drawn by ffmpeg's libass filter. Use a static full build if the installed ffmpeg lacks it.
FF="$(command -v ffmpeg || true)"
[ -x /opt/homebrew/bin/ffmpeg ] && FF=/opt/homebrew/bin/ffmpeg
if [ -z "$FF" ] || ! "$FF" -hide_banner -filters 2>/dev/null | grep -q " ass "; then
  echo "Downloading a full static ffmpeg (with libass) into the panel's bin/..."
  for tool in ffmpeg ffprobe; do
    curl -fL --progress-bar -o "$TMP/$tool.zip" "https://evermeet.cx/ffmpeg/getrelease/$tool/zip"
    unzip -o -q "$TMP/$tool.zip" -d "$BIN"
    chmod +x "$BIN/$tool"
  done
fi

MFILE="$DEST/models/ggml-$MODEL.bin"
if [ ! -f "$MFILE" ]; then
  echo "Downloading the '$MODEL' speech model..."
  curl -fL --progress-bar -o "$MFILE" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
fi

xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
echo
echo "Done. Restart Premiere Pro, then open Window > Extensions > Popline Captions."
