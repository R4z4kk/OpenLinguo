FROM openlinguo-rocm-wsl:6.4.2

# The repository pins torch 2.3.1 (CUDA); its inference code runs on 2.8.0, the ROCm 6.4 build tested on the
# Radeon. requirements.lock: uv lock of the inference subset of requirements.txt (no training, evaluation or demo
# packages, CPU onnxruntime), torch excluded.
RUN pip3 install --no-cache-dir torch==2.8.0+rocm6.4 torchaudio==2.8.0+rocm6.4 \
    --index-url https://download.pytorch.org/whl/rocm6.4 \
  && /opt/use-wsl-runtime.sh
COPY requirements.lock /opt/requirements.lock
RUN pip3 install --no-cache-dir --no-deps -r /opt/requirements.lock

ARG GLM_TTS_COMMIT=4b944f4be7b6c55454751715081f4dc83992897a
RUN git clone https://github.com/zai-org/GLM-TTS.git /opt/GLM-TTS \
  && cd /opt/GLM-TTS \
  && git checkout "$GLM_TTS_COMMIT"

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/server.py"]
