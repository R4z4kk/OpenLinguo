# CPU image: upstream runtime/python/Dockerfile is CUDA only.
FROM python:3.10-slim@sha256:6ff506466f8b1e981719b468cc0023b8ef000b983cdec0eafe119d01f379e31d

# Old sdists (openai-whisper) import pkg_resources, removed from recent setuptools.
RUN echo "setuptools<70" > /etc/pip-constraints.txt
ENV PIP_CONSTRAINT=/etc/pip-constraints.txt

RUN apt-get update \
  && apt-get install -y --no-install-recommends git build-essential sox libsox-dev ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ARG COSYVOICE_COMMIT=074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc
RUN git clone https://github.com/FunAudioLLM/CosyVoice.git /opt/CosyVoice \
  && cd /opt/CosyVoice \
  && git checkout "$COSYVOICE_COMMIT" \
  && git submodule update --init --recursive

WORKDIR /opt/CosyVoice
RUN grep -vE '^(--extra-index-url|deepspeed|onnxruntime-gpu|tensorrt|torch|torchaudio)' requirements.txt > requirements-cpu.txt \
  && pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu torch==2.3.1+cpu torchaudio==2.3.1+cpu \
  && pip install --no-cache-dir -r requirements-cpu.txt onnxruntime==1.18.0 huggingface_hub==0.30.2

COPY server.py /opt/server.py
EXPOSE 8000
ENTRYPOINT ["python", "/opt/server.py"]
