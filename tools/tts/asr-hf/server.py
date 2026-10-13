import io
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

import librosa
import numpy as np
import soundfile
import torch
from huggingface_hub import snapshot_download

REPO = os.environ["MODEL_REPO"]
REVISION = os.environ["MODEL_REVISION"]
# "whisper" or "qwen3-asr"
KIND = os.environ["MODEL_KIND"]
SAMPLE_RATE = 16_000

model_dir = snapshot_download(REPO, revision=REVISION, local_dir=f"/models/{REPO.split('/')[1]}")
if KIND == "whisper":
    from transformers import pipeline

    whisper = pipeline("automatic-speech-recognition", model=model_dir, dtype=torch.float16, device="cuda")
else:
    from qwen_asr import Qwen3ASRModel

    qwen = Qwen3ASRModel.from_pretrained(model_dir, dtype=torch.bfloat16, device_map="cuda:0")


def transcribe(wav: bytes) -> str:
    data, sample_rate = soundfile.read(io.BytesIO(wav), dtype="float32", always_2d=True)
    speech = librosa.resample(data.mean(axis=1), orig_sr=sample_rate, target_sr=SAMPLE_RATE)
    if KIND == "whisper":
        result = whisper(
            {"raw": speech, "sampling_rate": SAMPLE_RATE},
            # Audio over 30 s (a runaway TTS output) needs Whisper's long-form mode, which predicts timestamps.
            return_timestamps=len(speech) > 30 * SAMPLE_RATE,
            generate_kwargs={"language": "chinese", "task": "transcribe"},
        )
        return result["text"]
    return qwen.transcribe(audio=(speech.astype(np.float32), SAMPLE_RATE), language="Chinese")[0].text


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
        info = {"engine": KIND, "model": REPO, "revision": REVISION}
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
