FROM openlinguo-rocm-wsl:6.4.2

# requirements.lock: uv lock of FireRedASR2S requirements.txt (4e7d9aa) plus soxr, torch excluded: the ROCm wheel
# comes from download.pytorch.org. The repository has no package metadata: it is cloned and put on PYTHONPATH.
RUN pip3 install --no-cache-dir -U pip==25.2 \
  && pip3 install --no-cache-dir torch==2.9.1+rocm6.4 torchaudio==2.9.1+rocm6.4 \
    --index-url https://download.pytorch.org/whl/rocm6.4 \
  && /opt/use-wsl-runtime.sh
COPY requirements.lock /opt/requirements.lock
RUN pip3 install --no-cache-dir --no-deps -r /opt/requirements.lock
RUN git clone https://github.com/FireRedTeam/FireRedASR2S /opt/FireRedASR2S \
  && git -C /opt/FireRedASR2S checkout 4e7d9aaf4482a47cec1724807026b9b151926eb5
ENV PYTHONPATH=/opt/FireRedASR2S

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/server.py"]
