FROM python:3.10-slim@sha256:6ff506466f8b1e981719b468cc0023b8ef000b983cdec0eafe119d01f379e31d

# Old sdists import pkg_resources, removed from recent setuptools.
RUN echo "setuptools<70" > /etc/pip-constraints.txt
ENV PIP_CONSTRAINT=/etc/pip-constraints.txt

RUN apt-get update \
  && apt-get install -y --no-install-recommends git build-essential libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

ARG MELOTTS_COMMIT=209145371cff8fc3bd60d7be902ea69cbdb7965a
RUN git clone https://github.com/myshell-ai/MeloTTS.git /opt/MeloTTS \
  && cd /opt/MeloTTS \
  && git checkout "$MELOTTS_COMMIT"

# pip's resolver backtracks for hours on the unpinned upstream requirements: install a uv lock instead
# (upstream requirements.txt without gradio, which only serves the demo UI; see tools/data-pipeline/README.md).
COPY requirements.lock /opt/requirements.lock
WORKDIR /opt/MeloTTS
RUN pip install --no-cache-dir --no-deps --extra-index-url https://download.pytorch.org/whl/cpu -r /opt/requirements.lock \
  && pip install --no-cache-dir --no-deps -e . \
  && python -m unidic download

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python", "/opt/server.py"]
