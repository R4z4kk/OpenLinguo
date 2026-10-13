FROM openlinguo-rocm-wsl:6.4.2

# requirements.lock: uv lock of dots.tts's dependencies at its recommended constraints, without gradio (demo UI
# only), torch excluded: the ROCm wheel comes from download.pytorch.org.
RUN pip3 install --no-cache-dir torch==2.8.0+rocm6.4 torchaudio==2.8.0+rocm6.4 \
    --index-url https://download.pytorch.org/whl/rocm6.4 \
  && /opt/use-wsl-runtime.sh
COPY requirements.lock /opt/requirements.lock
RUN pip3 install --no-cache-dir --no-deps -r /opt/requirements.lock

ARG DOTS_TTS_COMMIT=b65ca7149fb43b8fb8d52916aa12738deda7b188
# Ubuntu 22.04's pip 22 cannot read PEP 621 metadata (installs "UNKNOWN").
RUN pip3 install --no-cache-dir pip==25.2 setuptools==80.9.0 \
  && pip3 install --no-cache-dir --no-deps "git+https://github.com/studio-dots-ai/dots.tts.git@${DOTS_TTS_COMMIT}"

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/server.py"]
