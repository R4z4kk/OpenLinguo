FROM openlinguo-rocm-wsl:6.4.2

# requirements.lock: uv lock of the inference dependencies of voxcpm 2.0.3 (no training, demo, ASR or denoiser
# packages), torch excluded: torchaudio 2.8 still reads wav files without torchcodec, which has no ROCm build.
RUN pip3 install --no-cache-dir torch==2.8.0+rocm6.4 torchaudio==2.8.0+rocm6.4 \
    --index-url https://download.pytorch.org/whl/rocm6.4 \
  && /opt/use-wsl-runtime.sh
COPY requirements.lock /opt/requirements.lock
RUN pip3 install --no-cache-dir --no-deps -r /opt/requirements.lock \
  && pip3 install --no-cache-dir --no-deps voxcpm==2.0.3

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/server.py"]
