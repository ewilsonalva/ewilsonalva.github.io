#!/usr/bin/env bash
# Build dist/Grabbit-<version>.zip from the tracked files (tool binaries are fetched by the installer).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' CSXS/manifest.xml)"
OUT="dist/Grabbit-$VERSION.zip"
STAGE="$(mktemp -d)/Grabbit-$VERSION"
mkdir -p "$STAGE" dist
for item in CSXS css js jsx index.html .debug install "Install Windows.bat" "Install Mac.command" README.md; do
  cp -R "$item" "$STAGE/"
done
mkdir -p "$STAGE/bin" && cp bin/README.md "$STAGE/bin/"
rm -f "$OUT"
(cd "$(dirname "$STAGE")" && zip -qrX "$OLDPWD/$OUT" "$(basename "$STAGE")")
echo "$OUT"
