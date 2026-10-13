# GPU base for the engines on a Radeon under WSL2 (Docker Desktop): AMD's WSL HSA runtime only, PyTorch brings
# the rest of ROCm. Run with --device /dev/dxg and /usr/lib/wsl/lib mounted (AMD "Use ROCm on Radeon GPUs", WSL guide).
# ROCm 6.4.2 is the newest WSL runtime tested working with Adrenalin 24.12 on an RX 7900 XTX (2026-10-13).
FROM ubuntu:22.04@sha256:5ec03bb3441e8b0bf3b4f9cd4629a1ae763010dc3035bb8da3ae6cf026486401

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates git python3 python3-pip ffmpeg libsndfile1 sox \
  && wget -q https://repo.radeon.com/amdgpu-install/6.4.2/ubuntu/jammy/amdgpu-install_6.4.60402-1_all.deb \
  && apt-get install -y ./amdgpu-install_6.4.60402-1_all.deb \
  && rm amdgpu-install_6.4.60402-1_all.deb \
  && apt-get update \
  && apt-get install -y --no-install-recommends hsa-runtime-rocr4wsl-amdgpu \
  && rm -rf /var/lib/apt/lists/*

ENV LD_LIBRARY_PATH=/usr/lib/wsl/lib

# Usage in an engine image, after installing a ROCm PyTorch wheel: RUN /opt/use-wsl-runtime.sh
RUN printf '%s\n' '#!/bin/sh' 'set -e' \
  'lib="$(python3 -c "import os, torch; print(os.path.dirname(torch.__file__))")/lib"' \
  'rm -f "$lib"/libhsa-runtime64.so*' \
  'cp /opt/rocm-6.4.2/lib/libhsa-runtime64.so.1.15.60402 "$lib/libhsa-runtime64.so"' > /opt/use-wsl-runtime.sh \
  && chmod +x /opt/use-wsl-runtime.sh
