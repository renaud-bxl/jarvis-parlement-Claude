#!/bin/bash
# Compile les deux assistants natifs, en binaires universels (arm64 + x86_64) :
#   jarvis-listen : reconnaissance vocale macOS ; jarvis-speak : voix humaine hors-ligne (moteur sherpa-onnx, Apache-2.0).
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

SV="v1.12.40"; LIBDIR="build/sherpa-onnx-$SV-osx-universal2-static-lib/lib"
if [ ! -d "$LIBDIR" ]; then
  curl -fsSL -o build/sherpa.tar.bz2 "https://github.com/k2-fsa/sherpa-onnx/releases/download/$SV/sherpa-onnx-$SV-osx-universal2-static-lib.tar.bz2"
  tar -xjf build/sherpa.tar.bz2 -C build && rm -f build/sherpa.tar.bz2
fi
L="$LIBDIR"
clang -O2 -arch arm64 -arch x86_64 -mmacosx-version-min=13.4 speak.c -I. -o build/jarvis-speak -Wl,-dead_strip \
  "$L/libsherpa-onnx-c-api.a" "$L/libsherpa-onnx-core.a" "$L/libkaldi-decoder-core.a" "$L/libsherpa-onnx-kaldifst-core.a" "$L/libsherpa-onnx-fst.a" \
  "$L/libsherpa-onnx-fstfar.a" "$L/libkaldi-native-fbank-core.a" "$L/libkissfft-float.a" "$L/libssentencepiece_core.a" "$L/libpiper_phonemize.a" \
  "$L/libespeak-ng.a" "$L/libucd.a" "$L/libonnxruntime.a" -lc++ -framework Foundation -framework CoreFoundation
codesign --force --sign - build/jarvis-speak
echo "✓ native/build/jarvis-speak ($(lipo -archs build/jarvis-speak))"

# Voix féminine par défaut (Siwis) incluse dans l'application : disponible dès l'installation, sans téléchargement ni voix du système.
VM="vits-piper-fr_FR-siwis-medium-int8"
if [ ! -f "build/voices/$VM/tokens.txt" ]; then
  mkdir -p build/voices
  curl -fsSL -o "build/voices/$VM.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$VM.tar.bz2"
  tar -xjf "build/voices/$VM.tar.bz2" -C build/voices && rm -f "build/voices/$VM.tar.bz2"
fi
test -f "build/voices/$VM/tokens.txt" && echo "✓ native/build/voices/$VM"
