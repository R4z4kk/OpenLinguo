import io
import json
import os
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import torch
from huggingface_hub import hf_hub_download
from melo.api import TTS

REPO = os.environ["MODEL_REPO"]
REVISION = os.environ["MODEL_REVISION"]

model = TTS(
    language="ZH",
    device="cpu",
    config_path=hf_hub_download(REPO, "config.json", revision=REVISION),
    ckpt_path=hf_hub_download(REPO, "checkpoint.pth", revision=REVISION),
)
speaker = model.hps.data.spk2id["ZH"]
sample_rate = model.hps.data.sampling_rate


def synthesize(text: str, seed: int) -> bytes:
    torch.manual_seed(seed)
    speech = model.tts_to_file(text, speaker, quiet=True)
    pcm = (np.clip(speech, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
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
        info = {"engine": "melotts", "model": REPO, "revision": REVISION, "speaker": "ZH"}
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
