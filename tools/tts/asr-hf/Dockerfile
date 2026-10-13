FROM openlinguo-rocm-wsl:6.4.2

# requirements.lock: uv lock of the qwen-asr 0.0.6 dependencies its transcription imports (not gradio, flask, vllm,
# sox, qwen-omni-utils, soynlp), which also run Whisper through transformers; torch excluded: the ROCm wheel comes
# from download.pytorch.org.
RUN pip3 install --no-cache-dir -U pip==25.2 \
  && pip3 install --no-cache-dir torch==2.9.1+rocm6.4 --index-url https://download.pytorch.org/whl/rocm6.4 \
  && /opt/use-wsl-runtime.sh
COPY requirements.lock /opt/requirements.lock
RUN pip3 install --no-cache-dir --no-deps -r /opt/requirements.lock qwen-asr==0.0.6

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/server.py"]
