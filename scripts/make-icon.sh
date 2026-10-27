#!/bin/bash
# Régénère build/icon.png et build/icon.icns depuis build/icon.svg (macOS uniquement).
set -euo pipefail
cd "$(dirname "$0")/../build"
../node_modules/.bin/electron ../scripts/make-icon.js >/dev/null 2>&1
rm -rf icon.iconset && mkdir icon.iconset
for s in 16 32 64 128 256 512; do sips -z $s $s icon.png --out icon.iconset/icon_${s}x${s}.png >/dev/null; sips -z $((s*2)) $((s*2)) icon.png --out icon.iconset/icon_${s}x${s}@2x.png >/dev/null; done
iconutil -c icns icon.iconset -o icon.icns && rm -rf icon.iconset
echo "OK : build/icon.icns"
