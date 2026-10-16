# WORLD vocoder for the tone transfer of the pinyin chart (#105, ADR 0007): CPU only, no model to download.
FROM ubuntu:22.04@sha256:5ec03bb3441e8b0bf3b4f9cd4629a1ae763010dc3035bb8da3ae6cf026486401

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-dev g++ libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

# requirements.lock: uv pip compile of pyworld 0.3.5 and its build dependencies for Python 3.10. pyworld has no
# Linux wheel: it is compiled from its sdist against the locked numpy and Cython, without build isolation.
COPY requirements.lock /opt/requirements.lock
RUN pip3 install --no-cache-dir -U pip==25.2 \
  && grep -v '^pyworld==' /opt/requirements.lock > /opt/build.lock \
  && pip3 install --no-cache-dir --no-deps -r /opt/build.lock \
  && pip3 install --no-cache-dir --no-deps --no-build-isolation "$(grep '^pyworld==' /opt/requirements.lock)"

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/server.py"]
