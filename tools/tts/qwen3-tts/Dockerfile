FROM python:3.10-slim@sha256:6ff506466f8b1e981719b468cc0023b8ef000b983cdec0eafe119d01f379e31d

RUN apt-get update \
  && apt-get install -y --no-install-recommends sox libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

# requirements.lock: uv lock of qwen-tts 0.1.1's dependencies without gradio (demo UI only), torch 2.6.0+cpu
# (recipe in tools/data-pipeline/README.md).
COPY requirements.lock /opt/requirements.lock
RUN pip install --no-cache-dir --no-deps --extra-index-url https://download.pytorch.org/whl/cpu -r /opt/requirements.lock \
  && pip install --no-cache-dir --no-deps qwen-tts==0.1.1

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python", "/opt/server.py"]
