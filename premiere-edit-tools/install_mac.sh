#!/bin/bash
# Installs the Edit Tools panel for Premiere Pro (macOS).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/EditTools"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/EditTools"
echo "Installing to $DEST"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$SRC" "$DEST"
# Allow unsigned extensions (CEP 9 - 13 covers Premiere Pro 2019 through 2026)
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
echo "Done. Restart Premiere Pro, then open Window > Extensions > Edit Tools."
