#!/bin/sh
# The licenses of what the WebAssembly binary is built from, in the build image (Dockerfile).
set -eu

section() {
  printf '\n==== %s ====\n\n' "$1"
  cat "$2"
}

echo "OpenLinguo's sherpa-onnx WebAssembly build: sherpa-onnx $SHERPA_ONNX_TAG ($SHERPA_ONNX_COMMIT),"
echo "ONNX Runtime $ONNXRUNTIME, Emscripten $EMSCRIPTEN_VERSION. Each library below is downloaded by"
echo "sherpa-onnx's cmake/<name>.cmake at that commit, which names its source archive and its sha256:"
echo "https://github.com/k2-fsa/sherpa-onnx/tree/$SHERPA_ONNX_COMMIT/cmake"
section "sherpa-onnx" /sherpa-onnx/LICENSE
for file in $(find /sherpa-onnx/build/_deps/*-src -maxdepth 1 -type f \( -name 'LICENSE*' -o -name 'COPYING*' \) | sort); do
  section "${file#/sherpa-onnx/build/_deps/}" "$file"
done
section "ONNX Runtime $ONNXRUNTIME" /licenses/onnxruntime/LICENSE
section "ONNX Runtime $ONNXRUNTIME third-party notices" /licenses/onnxruntime/ThirdPartyNotices.txt
section "Emscripten $EMSCRIPTEN_VERSION (runtime and system libraries)" "$EMSDK/upstream/emscripten/LICENSE"
