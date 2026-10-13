import io
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import soundfile
import soxr
from fireredasr2s.fireredasr2 import FireRedAsr2, FireRedAsr2Config
from huggingface_hub import snapshot_download

REPO = os.environ["MODEL_REPO"]
REVISION = os.environ["MODEL_REVISION"]
SAMPLE_RATE = 16_000

model_dir = snapshot_download(REPO, revision=REVISION, local_dir=f"/models/{REPO.split('/')[1]}")
model = FireRedAsr2.from_pretrained("aed", model_dir, FireRedAsr2Config(use_gpu=True))


def transcribe(wav: bytes) -> str:
    data, sample_rate = soundfile.read(io.BytesIO(wav), dtype="float32", always_2d=True)
    speech = soxr.resample(data.mean(axis=1), sample_rate, SAMPLE_RATE)
    # The Kaldi filterbank expects 16-bit sample values.
    samples = np.clip(speech * 32768, -32768, 32767).astype(np.int16)
    # transcribe() logs its own exceptions and returns an empty text, which never matches an item: the file fails
    # the check instead of passing it.
    return model.transcribe(["item"], [(SAMPLE_RATE, samples)])[0]["text"]


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
        info = {"engine": "firered-asr", "model": REPO, "revision": REVISION}
        self.reply(200, json.dumps(info).encode(), "application/json")

    def do_POST(self) -> None:
        if self.path != "/transcribe":
            self.reply(404, b"not found", "text/plain")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            text = transcribe(self.rfile.read(length))
            self.reply(200, json.dumps({"text": text}, ensure_ascii=False).encode(), "application/json")
        except Exception as error:
            self.reply(500, str(error).encode(), "text/plain")


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
