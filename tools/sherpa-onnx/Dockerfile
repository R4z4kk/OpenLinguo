# sherpa-onnx compiled to WebAssembly for the speech worker (ADR 0007, #119): offline recognition only,
# one thread, no preloaded files, an ES module factory for a module worker, no eval.
#   docker build --output type=local,dest=tools/sherpa-onnx/out tools/sherpa-onnx
# emsdk 4.0.23 is the version sherpa-onnx's build scripts name as known to work.
FROM emscripten/emsdk:4.0.23@sha256:86537645c51e44899812d29820ee3b64b96c321ebb2aba4416a04ceeb1bcde62 AS build

ARG SHERPA_ONNX_TAG=v1.13.8
ARG SHERPA_ONNX_COMMIT=11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf
# The static library sherpa-onnx's cmake/onnxruntime-wasm-simd.cmake downloads at that commit.
ARG ONNXRUNTIME=1.28.2

RUN git clone --depth 1 --branch "$SHERPA_ONNX_TAG" https://github.com/k2-fsa/sherpa-onnx.git /sherpa-onnx \
  && test "$(git -C /sherpa-onnx rev-parse HEAD)" = "$SHERPA_ONNX_COMMIT" \
  && grep -q "static_lib-simd-$ONNXRUNTIME.zip" /sherpa-onnx/cmake/onnxruntime-wasm-simd.cmake

# Options of sherpa-onnx's build-wasm-simd-vad-asr.sh, without its demo targets.
WORKDIR /sherpa-onnx/build
RUN cmake \
    -DCMAKE_INSTALL_PREFIX=/sherpa-onnx/install \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE="$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake" \
    -DSHERPA_ONNX_ENABLE_PYTHON=OFF \
    -DSHERPA_ONNX_ENABLE_TESTS=OFF \
    -DSHERPA_ONNX_ENABLE_CHECK=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF \
    -DSHERPA_ONNX_ENABLE_JNI=OFF \
    -DSHERPA_ONNX_ENABLE_TTS=OFF \
    -DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=OFF \
    -DSHERPA_ONNX_ENABLE_C_API=ON \
    -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF \
    -DSHERPA_ONNX_ENABLE_GPU=OFF \
    -DSHERPA_ONNX_ENABLE_WASM=ON \
    -DSHERPA_ONNX_ENABLE_BINARY=OFF \
    -DSHERPA_ONNX_LINK_LIBSTDCPP_STATICALLY=OFF \
    .. \
  && make -j"$(nproc)" install

# Paraformer-small peaks at 133 MiB of memory (the demo build reserves 512 MiB).
COPY openlinguo-asr.c /openlinguo/
RUN mkdir /out && emcc -O3 -I/sherpa-onnx /openlinguo/openlinguo-asr.c /sherpa-onnx/install/lib/*.a \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sDYNAMIC_EXECUTION=0 \
    -sFORCE_FILESYSTEM=1 -sINITIAL_MEMORY=160MB -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=10485760 \
    "-sEXPORTED_FUNCTIONS=[_malloc,_free,_OpenLinguoCreateRecognizer,_OpenLinguoTranscribe]" \
    "-sEXPORTED_RUNTIME_METHODS=[FS_createDataFile,FS_unlink,stringToNewUTF8,UTF8ToString,HEAPF32]" \
    -o /out/sherpa-onnx-asr.mjs

ADD --checksum=sha256:2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c \
  https://raw.githubusercontent.com/microsoft/onnxruntime/v${ONNXRUNTIME}/LICENSE /licenses/onnxruntime/LICENSE
ADD --checksum=sha256:0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2 \
  https://raw.githubusercontent.com/microsoft/onnxruntime/v${ONNXRUNTIME}/ThirdPartyNotices.txt /licenses/onnxruntime/ThirdPartyNotices.txt
COPY licenses.sh /openlinguo/
RUN export EMSCRIPTEN_VERSION="$(emcc --version | sed -n '1s/.* \([0-9][0-9.]*\) (.*/\1/p')" \
  && printf '{\n  "sherpaOnnx": "%s",\n  "commit": "%s",\n  "onnxruntime": "%s",\n  "emscripten": "%s"\n}\n' \
    "$SHERPA_ONNX_TAG" "$SHERPA_ONNX_COMMIT" "$ONNXRUNTIME" "$EMSCRIPTEN_VERSION" > /out/build.json \
  && sh /openlinguo/licenses.sh > /out/THIRD-PARTY-LICENSES.txt \
  && cd /out && sha256sum sherpa-onnx-asr.mjs sherpa-onnx-asr.wasm build.json THIRD-PARTY-LICENSES.txt > SHA256SUMS

FROM scratch
COPY --from=build /out/ /
