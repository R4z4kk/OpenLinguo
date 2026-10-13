FROM openlinguo-rocm-wsl:6.4.2

# requirements.lock: uv lock of the MOSS-TTS runtime (pyproject of OpenMOSS/MOSS-TTS 934d682, scipy 1.15.3 for
# Python 3.10, without gradio), torch excluded: the ROCm wheel comes from download.pytorch.org.
RUN pip3 install --no-cache-dir torch==2.9.1+rocm6.4 torchaudio==2.9.1+rocm6.4 \
    --index-url https://download.pytorch.org/whl/rocm6.4 \
  && /opt/use-wsl-runtime.sh
COPY requirements.lock /opt/requirements.lock
RUN pip3 install --no-cache-dir --no-deps -r /opt/requirements.lock

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/server.py"]
