import base64
import io
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from importlib.metadata import version

import numpy as np
import pyworld
import soundfile

# 5 ms frames; F0 searched from 70 to 600 Hz, the range of the synthetic voice and its tones.
FRAME_MS = 5.0
F0_FLOOR = 70.0
F0_CEIL = 600.0
# A contour has this many points over the voiced stretch, in semitones above 100 Hz.
POINTS = 20
REFERENCE_HZ = 100.0


def read(wav: bytes) -> tuple[np.ndarray, int]:
    data, sample_rate = soundfile.read(io.BytesIO(wav), dtype="float64", always_2d=True)
    return np.ascontiguousarray(data.mean(axis=1)), sample_rate


def analyse(samples: np.ndarray, sample_rate: int):
    f0, times = pyworld.harvest(samples, sample_rate, f0_floor=F0_FLOOR, f0_ceil=F0_CEIL, frame_period=FRAME_MS)
    envelope = pyworld.cheaptrick(samples, f0, times, sample_rate)
    aperiodicity = pyworld.d4c(samples, f0, times, sample_rate)
    return f0, envelope, aperiodicity


def voiced_span(f0: np.ndarray) -> tuple[int, int] | None:
    voiced = np.flatnonzero(f0 > 0)
    return (int(voiced[0]), int(voiced[-1]) + 1) if len(voiced) > 0 else None


def contour(f0: np.ndarray, span: tuple[int, int]) -> list[float]:
    """The voiced stretch in POINTS points, unvoiced frames inside it filled in from their neighbours."""
    stretch = f0[span[0] : span[1]]
    frames = np.arange(len(stretch))
    voiced = stretch > 0
    semitones = np.interp(frames, frames[voiced], 12 * np.log2(stretch[voiced] / REFERENCE_HZ))
    return np.interp(np.linspace(0, len(stretch) - 1, POINTS), frames, semitones).round(3).tolist()


def resample_frames(frames: np.ndarray, count: int) -> np.ndarray:
    at = np.linspace(0, len(frames) - 1, count)
    low = np.floor(at).astype(int)
    high = np.minimum(low + 1, len(frames) - 1)
    weight = (at - low)[:, None]
    return frames[low] * (1 - weight) + frames[high] * weight


def transfer(samples: np.ndarray, sample_rate: int, target: list[float], seconds: float) -> np.ndarray:
    """
    The same consonant and vowel with another pitch: the voiced stretch is stretched to `seconds` and its F0
    replaced by `target`; what lies before and after it (an unvoiced initial, silence) is kept as it is.
    """
    f0, envelope, aperiodicity = analyse(samples, sample_rate)
    span = voiced_span(f0)
    if span is None:
        raise ValueError("nothing voiced in the recording")
    start, end = span
    count = max(4, round(seconds * 1000 / FRAME_MS))
    pitch = REFERENCE_HZ * 2 ** (np.interp(np.linspace(0, POINTS - 1, count), np.arange(POINTS), target) / 12)
    new_f0 = np.concatenate([np.zeros(start), pitch, np.zeros(len(f0) - end)])
    new_envelope = np.concatenate([envelope[:start], resample_frames(envelope[start:end], count), envelope[end:]])
    new_aperiodicity = np.concatenate(
        [aperiodicity[:start], resample_frames(aperiodicity[start:end], count), aperiodicity[end:]]
    )
    speech = pyworld.synthesize(
        np.ascontiguousarray(new_f0),
        np.ascontiguousarray(new_envelope),
        np.ascontiguousarray(new_aperiodicity),
        sample_rate,
        FRAME_MS,
    )
    # Same peak level as the source.
    return speech * (np.max(np.abs(samples)) / max(1e-9, np.max(np.abs(speech))))


def wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    out = io.BytesIO()
    soundfile.write(out, np.clip(samples, -1.0, 1.0), sample_rate, format="WAV", subtype="PCM_16")
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
        info = {"engine": "world", "version": f"pyworld {version('pyworld')}"}
        self.reply(200, json.dumps(info).encode(), "application/json")

    def do_POST(self) -> None:
        try:
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            if self.path == "/analyse":
                samples, sample_rate = read(body)
                f0, _, _ = analyse(samples, sample_rate)
                span = voiced_span(f0)
                info = (
                    {"seconds": None, "contour": None}
                    if span is None
                    else {"seconds": (span[1] - span[0]) * FRAME_MS / 1000, "contour": contour(f0, span)}
                )
                self.reply(200, json.dumps(info).encode(), "application/json")
            elif self.path == "/transfer":
                request = json.loads(body)
                target, seconds = request["contour"], request["seconds"]
                if len(target) != POINTS or not all(isinstance(value, (int, float)) for value in target):
                    raise ValueError(f"expected a contour of {POINTS} numbers")
                if not isinstance(seconds, (int, float)) or not 0.05 <= seconds <= 3:
                    raise ValueError("expected a duration from 0.05 to 3 s")
                samples, sample_rate = read(base64.b64decode(request["wav"]))
                self.reply(200, wav_bytes(transfer(samples, sample_rate, target, seconds), sample_rate), "audio/wav")
            else:
                self.reply(404, b"not found", "text/plain")
        except Exception as error:
            self.reply(500, str(error).encode(), "text/plain")


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
