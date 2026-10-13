# 0007 — Speech stack

- Status: Accepted
- Date: 2026-10-09; Mandarin TTS decided 2026-10-13 (bake-off #112)

## Context

Tone training needs reference audio with an analyzable pitch contour. Browser speech synthesis exposes no audio buffer, so its pitch cannot be analyzed. Voice data must stay on the device.

## Decision

- Reference audio is pre-generated with open neural TTS and served as static files; F0 contours are extracted offline by the pipeline.
- English: Kokoro-82M (Apache-2.0). Kokoro is rejected for Mandarin (all zh voices graded D).
- Mandarin: **MOSS-TTS v1.5** (OpenMOSS, 8B, Apache-2.0) for every recording: syllables, words and sentences.
  - Isolated words are sent with a final 。: without it MOSS-TTS often does not stop (its maintainers' advice for end-of-utterance problems, OpenMOSS/MOSS-TTS#19). Its server caps the length at about 2 s per syllable.
  - It clones `tools/tts/voices/designed-zh-female.wav`, a synthetic voice made by MOSS-VoiceGenerator (Apache-2.0) from a text description. No real person's voice is reproduced, so we read the audio as no deep fake in the sense of the AI Act (art. 3(60): content that "resembles existing persons"; art. 50(4) unchanged by Regulation (EU) 2026/1744). Generated audio is still labelled « synthetic voice » in the app (#113).
- TTS engines run as Docker containers called over HTTP by the TypeScript pipeline (`tools/tts`, `tools/data-pipeline/src/tts`), with pinned commits, model revisions, dependency locks and seeds. They run on the maintainer's Radeon RX 7900 XTX through WSL2: AMD's ROCm 6.4.2 WSL runtime with PyTorch ROCm wheels, tested with the Adrenalin 24.12 driver (AMD certifies WSL only with its "for WSL2" drivers).
- Pitch: one F0 implementation (`pitchy`, MIT) shared by the pipeline and the browser; semitones normalized to the speaker's mean, time-normalized comparison. Raw pitchy contours make octave errors on TTS audio, corrected in #114.
- STT: Whisper via transformers.js in a Web Worker (WebGPU, WASM fallback), model downloaded on demand; opencc-js converts traditional output to simplified.
- STT checks intelligibility only; tone accuracy comes from the pitch module.

## Mandarin bake-off (#112)

36 items (tone sets in isolation and in words, third-tone sandhi, 一 and 不, neutral tone, erhua, polyphones, sentences; readings checked against CC-CEDICT), one seed, every engine's version side by side in a fixed, named order. The maintainer listened and ruled.

| Engine (revision) | License | Outcome |
|---|---|---|
| MeloTTS-Chinese (`af5d207`) | MIT | Rejected (round 1) |
| dots.tts-soar (`2f9b3e1`) | Apache-2.0 | Rejected; runs on past the text (12 s for a 2 s sentence) |
| CosyVoice-300M-SFT, voice 中文女 (`fbb71de`) | Apache-2.0 | Rejected: acceptable, clearly below MOSS and GLM |
| Fun-CosyVoice3-0.5B-2512, bundled prompt for evaluation only (`29e01c4`) | Apache-2.0 | Rejected: same |
| Qwen3-TTS-12Hz-1.7B-CustomVoice, voice Serena (`0c0e305`) | Apache-2.0 | Rejected: frequent added words |
| GLM-TTS (`b3feb69`) | MIT (weights), Apache-2.0 (code) | Rejected: best version on 3 of 36 items, frequent added words; phoneme input made it fast and repetitive |
| MOSS-TTS v1.5 fed tone-numbered pinyin | — | Rejected: best on 5 of 36 items, never stops on 13 |
| VoxCPM2 (`32279ef`) | Apache-2.0 | Rejected (round 2); some outputs too short for their syllables |
| MOSS-TTS v1.5 (`cdd3b91`) | Apache-2.0 | Best on 28 of 36 items in round 1; **kept with a final 。** in round 2 |

- MOSS-TTS and GLM-TTS publish no Chinese listening test (objective metrics only) and appear in no human-preference arena. Feedback from Chinese users in the projects' issues agreed with the listening: GLM-TTS's released weights are the base model, not the RL model behind its best scores (zai-org/GLM-TTS#23), and users report swallowed or wrong characters when cloning (#15) and choppy prosody with phonemes (#35); MOSS-TTS is praised for realism and its maintainers advise plain cloning over continuation, which can mix in the reference text (OpenMOSS/MOSS-TTS#156).
- A GLM-TTS word followed by the MOSS-TTS sentence containing it (6 flashcards, same cloned voice) sounded about the same as MOSS-TTS for both, so one engine is kept.
- MOSS sounds closer to connected speech (tones reduced and coarticulated, as natives speak: Xu 1997, *Journal of Phonetics* 25) where other engines keep textbook contours; the maintainer preferred it.
- With the final 。, 2 of 36 items still reached the length cap: 烫 ran on in silence, 一个 added a stray sound after 3 s of silence. The pipeline now keeps the first utterance of every file: audio after a pause longer than 0.7 s is dropped and the silence around it trimmed to 0.1 s.
- Findings carried to the audio packs (#113): a word added without a pause is not caught by trimming. Mitigations to choose there: duration control, and a speech-recognition check that regenerates with another seed and lists the remaining failures for human validation.
- Other open Mandarin models checked 2026-10-12/13 and excluded by license: F5-TTS, Fish-Speech / Fish Audio S2 Pro, Spark-TTS, ChatTTS, MaskGCT, Llasa, Breeze-TTS-2, Raon-OpenTTS (non-commercial), IndexTTS-2.5 (bilibili license, cloning only).

## Consequences

- Recordings never leave the device.
- Generating audio needs the GPU: about 2–3 s per item on the RX 7900 XTX.
- One engine to maintain, one voice file pinned in the repository.
- Audio pack hosting (Pages, R2 or self-hosted S3) and model mirroring are decided in M3 (#113, #119).
