import io
import json
import os
import sys
import types
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import torch
from huggingface_hub import snapshot_download

REPO = os.environ["MODEL_REPO"]
REVISION = os.environ["MODEL_REVISION"]
REFERENCE_WAV = os.environ["REFERENCE_WAV"]
REFERENCE_TEXT = os.environ["REFERENCE_TEXT"]
SAMPLE_RATE = 24000

# The frontend calls torch.npu.is_available() unguarded (Ascend NPU support).
if not hasattr(torch, "npu"):
    torch.npu = types.SimpleNamespace(is_available=lambda: False)

# glmtts_inference reads ckpt/ and frontend/ relative to the repository.
os.chdir("/opt/GLM-TTS")
sys.path.insert(0, "/opt/GLM-TTS")
model_dir = snapshot_download(REPO, revision=REVISION, local_dir=f"/models/{REPO.split('/')[1]}")
if not os.path.islink("ckpt"):
    os.symlink(model_dir, "ckpt")

from glmtts_inference import DEVICE, generate_long, load_models  # noqa: E402

frontend, text_frontend, _, llm, flow = load_models(use_phoneme=False, sample_rate=SAMPLE_RATE)
prompt_text = text_frontend.text_normalize(REFERENCE_TEXT)
prompt_text_token = frontend._extract_text_token(prompt_text + " ")
prompt_speech_token = frontend._extract_speech_token([REFERENCE_WAV]).squeeze().tolist()
speech_feat = frontend._extract_speech_feat(REFERENCE_WAV, sample_rate=SAMPLE_RATE)
embedding = frontend._extract_spk_embedding(REFERENCE_WAV)
flow_prompt_token = torch.tensor([prompt_speech_token], dtype=torch.int32).to(DEVICE)


def synthesize(text: str, seed: int) -> bytes:
    cache = {
        "cache_text": [prompt_text],
        "cache_text_token": [prompt_text_token],
        "cache_speech_token": [prompt_speech_token],
        "use_cache": True,
    }
    with torch.no_grad():
        speech, _, _, _ = generate_long(
            frontend=frontend,
            text_frontend=text_frontend,
            llm=llm,
            flow=flow,
            text_info=["request", text_frontend.text_normalize(text)],
            cache=cache,
            embedding=embedding,
            seed=seed,
            flow_prompt_token=flow_prompt_token,
            speech_feat=speech_feat,
            device=DEVICE,
        )
    samples = speech.float().cpu().squeeze().numpy()
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    return out.getvalue()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.reply(404, b"not found", "text/plain")
            return
        info = {"engine": "glm-tts", "model": REPO, "revision": REVISION, "speaker": os.path.basename(REFERENCE_WAV)}
        self.reply(200, json.dumps(info).encode(), "application/json")

    def do_POST(self) -> None:
        if self.path != "/synthesize":
            self.reply(404, b"not found", "text/plain")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length))
            text, seed = request["text"], request["seed"]
            if not isinstance(text, str) or not text.strip() or not isinstance(seed, int):
                raise ValueError("expected a non-empty text and an integer seed")
            self.reply(200, synthesize(text, seed), "audio/wav")
        except Exception as error:
            self.reply(500, str(error).encode(), "text/plain")


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
