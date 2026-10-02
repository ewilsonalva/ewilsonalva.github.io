#!/usr/bin/env bash
# Build dist/Popline-<version>.zip from the tracked files (tool binaries are fetched by the installer).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' CSXS/manifest.xml)"
OUT="dist/Popline-$VERSION.zip"
STAGE="$(mktemp -d)/Popline-$VERSION"
mkdir -p "$STAGE" dist
for item in CSXS css js jsx fonts index.html .debug install "Install Windows.bat" "Install Mac.command" README.md; do
  cp -R "$item" "$STAGE/"
done
mkdir -p "$STAGE/bin" "$STAGE/models" && cp bin/README.txt "$STAGE/bin/" && cp models/README.txt "$STAGE/models/"
rm -f "$OUT"
(cd "$(dirname "$STAGE")" && zip -qrX "$OLDPWD/$OUT" "$(basename "$STAGE")")
echo "$OUT"
