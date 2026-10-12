import io
import json
import os
import sys
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path += ["/opt/CosyVoice", "/opt/CosyVoice/third_party/Matcha-TTS"]

import numpy as np
from cosyvoice.cli.cosyvoice import AutoModel
from cosyvoice.utils.common import set_all_random_seed
from huggingface_hub import snapshot_download

REPO = os.environ["MODEL_REPO"]
REVISION = os.environ["MODEL_REVISION"]
SPEAKER = os.environ.get("SPEAKER", "")
PROMPT_WAV = "/opt/CosyVoice/asset/zero_shot_prompt.wav"
PROMPT_TEXT = "You are a helpful assistant.<|endofprompt|>希望你以后能够做的比我还好呦。"

model_dir = snapshot_download(REPO, revision=REVISION, local_dir=f"/models/{REPO.split('/')[1]}")
model = AutoModel(model_dir=model_dir)


def synthesize(text: str, seed: int) -> bytes:
    set_all_random_seed(seed)
    if SPEAKER:
        chunks = model.inference_sft(text, SPEAKER, stream=False)
    else:
        chunks = model.inference_zero_shot(text, PROMPT_TEXT, PROMPT_WAV, stream=False)
    speech = np.concatenate([chunk["tts_speech"].numpy().reshape(-1) for chunk in chunks])
    pcm = (np.clip(speech, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(model.sample_rate)
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
        info = {"engine": "cosyvoice", "model": REPO, "revision": REVISION, "speaker": SPEAKER or "zero-shot"}
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
