# 0007 — Speech stack

- Status: Accepted (Mandarin TTS engine pending M3 bake-off)
- Date: 2026-10-09

## Context

Tone training needs reference audio with an analyzable pitch contour. Browser speech synthesis exposes no audio buffer, so its pitch cannot be analyzed. Voice data must stay on the device.

## Decision

- Reference audio is pre-generated with open neural TTS and served as static files; F0 contours are extracted offline by the pipeline.
- English: Kokoro-82M (Apache-2.0). Mandarin: Kokoro is rejected (all zh voices graded D); CosyVoice 3 (Apache-2.0) vs MeloTTS (MIT) bake-off with human listening on tone minimal pairs and third-tone sandhi.
- TTS engines run as Docker containers called over HTTP by the TypeScript pipeline.
- Pitch: one F0 implementation (`pitchy`) shared by the pipeline and the browser; semitones normalized to the speaker's mean, time-normalized comparison.
- STT: Whisper via transformers.js in a Web Worker (WebGPU, WASM fallback), model downloaded on demand; opencc-js converts traditional output to simplified.
- STT checks intelligibility only; tone accuracy comes from the pitch module.

## Consequences

- Recordings never leave the device.
- Audio pack hosting (Pages, R2 or self-hosted S3) and model mirroring are decided in M3.
