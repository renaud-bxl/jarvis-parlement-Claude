#!/bin/bash
# Compile l'assistant d'écoute (reconnaissance vocale macOS) en binaire universel arm64 + x86_64.
set -euo pipefail
cd "$(dirname "$0")/../native"
mkdir -p build
for A in arm64 x86_64; do
  swiftc -O -target "$A-apple-macos13.0" listen.swift -o "build/listen-$A" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker listen-Info.plist
done
lipo -create build/listen-arm64 build/listen-x86_64 -output build/jarvis-listen
rm -f build/listen-arm64 build/listen-x86_64
codesign --force --sign - build/jarvis-listen
echo "✓ native/build/jarvis-listen ($(lipo -archs build/jarvis-listen))"
