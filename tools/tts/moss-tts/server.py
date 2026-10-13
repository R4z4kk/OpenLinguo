import io
import json
import os
import re
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import soundfile
import torch
from huggingface_hub import snapshot_download
from transformers import AutoModel, AutoProcessor

REPO = os.environ["MODEL_REPO"]
REVISION = os.environ["MODEL_REVISION"]
CODEC_REPO = os.environ["CODEC_REPO"]
CODEC_REVISION = os.environ["CODEC_REVISION"]
# "tts" clones REFERENCE_WAV; "voice-generator" designs a voice from the request's instruction.
KIND = os.environ["MODEL_KIND"]
REFERENCE_WAV = os.environ.get("REFERENCE_WAV", "")
# The 8B model and the 1.6B codec in float32 overflow a 24 GB card next to the desktop: CODEC_DTYPE=bfloat16.
CODEC_DTYPE = getattr(torch, os.environ.get("CODEC_DTYPE", "float32"))
DEVICE = "cuda"
SYLLABLE = re.compile(r"[一-鿿]|[a-zü]+[1-5]?", re.IGNORECASE)

torch.backends.cuda.enable_cudnn_sdp(False)
model_dir = snapshot_download(REPO, revision=REVISION, local_dir=f"/models/{REPO.split('/')[1]}")
codec_dir = snapshot_download(CODEC_REPO, revision=CODEC_REVISION, local_dir=f"/models/{CODEC_REPO.split('/')[1]}")
processor = AutoProcessor.from_pretrained(
    model_dir,
    trust_remote_code=True,
    codec_path=codec_dir,
    **({"normalize_inputs": True} if KIND == "voice-generator" else {}),
)
processor.audio_tokenizer = processor.audio_tokenizer.to(DEVICE, dtype=CODEC_DTYPE)
model = AutoModel.from_pretrained(
    model_dir, trust_remote_code=True, attn_implementation="sdpa", dtype=torch.bfloat16
).to(DEVICE)
model.eval()


def encode_reference() -> torch.Tensor:
    # torchaudio.load needs torchcodec, which has no ROCm build: read with soundfile, encode once.
    data, sample_rate = soundfile.read(REFERENCE_WAV, dtype="float32", always_2d=True)
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=CODEC_DTYPE != torch.float32):
        return processor.encode_audios_from_wav(
            [torch.from_numpy(data.T.copy())], sampling_rate=sample_rate, n_vq=processor.model_config.n_vq
        )[0]


reference_codes = encode_reference() if KIND == "tts" else None


def synthesize(text: str, seed: int, instruction: str) -> bytes:
    torch.manual_seed(seed)
    if KIND == "voice-generator":
        message = processor.build_user_message(text=text, instruction=instruction)
    else:
        message = processor.build_user_message(text=text, reference=[reference_codes], language="Chinese")
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=CODEC_DTYPE != torch.float32):
        batch = processor([[message]], mode="generation")
        outputs = model.generate(
            input_ids=batch["input_ids"].to(DEVICE),
            attention_mask=batch["attention_mask"].to(DEVICE),
            # 12.5 audio frames per second: about 2 s per syllable (a character or a pinyin syllable), so a model
            # that never stops on a short input yields an audible failure instead of minutes of audio.
            max_new_tokens=min(4096, 40 + 25 * len(SYLLABLE.findall(text))),
        )
        audio = next(iter(processor.decode(outputs))).audio_codes_list[0].detach().float().cpu()
    speech = (audio.mean(dim=0) if audio.ndim == 2 else audio).numpy()
    pcm = (np.clip(speech, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(processor.model_config.sampling_rate)
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
        speaker = os.path.basename(REFERENCE_WAV) if KIND == "tts" else "instruction"
        info = {"engine": f"moss-{KIND}", "model": REPO, "revision": REVISION, "speaker": speaker}
        self.reply(200, json.dumps(info).encode(), "application/json")

    def do_POST(self) -> None:
        if self.path != "/synthesize":
            self.reply(404, b"not found", "text/plain")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length))
            text, seed = request["text"], request["seed"]
            instruction = request.get("instruction", "")
            if not isinstance(text, str) or not text.strip() or not isinstance(seed, int):
                raise ValueError("expected a non-empty text and an integer seed")
            if KIND == "voice-generator" and not instruction:
                raise ValueError("the voice generator needs an instruction")
            self.reply(200, synthesize(text, seed, instruction), "audio/wav")
        except Exception as error:
            self.reply(500, str(error).encode(), "text/plain")


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
