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
  - It clones `tools/tts/voices/designed-zh-female.wav`, a synthetic voice made by MOSS-VoiceGenerator (Apache-2.0) from a text description: the third of three candidates, as the first spoke too fast for learners and the second too slow. No real person's voice is reproduced, so we read the audio as no deep fake in the sense of the AI Act (art. 3(60): content that "resembles existing persons"; art. 50(4) unchanged by Regulation (EU) 2026/1744). Generated audio is still labelled « synthetic voice » in the app (#113).
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

## Speech-recognition check (#113)

Every generated recording is transcribed by **Qwen3-ASR-1.7B** (Qwen, Apache-2.0, revision `7278e1e`) before it ships. A file passes when the transcript has one character per syllable, each one readable as the expected syllable, tones aside (CC-CEDICT readings; homophones, traditional forms, digits and erhua written without 儿 pass; any other word fails). Tones are left to the pitch module (#114, #115). Qwen3-ASR runs in the pipeline only; the app's speech recognition is decided in #119.

Compared on 2026-10-14 on the 360 bake-off samples (every engine, rejected ones included for their failures). The maintainer labelled by ear the 51 files the recognizers disagreed on; 5 had a word added, missing or changed.

| Recognizer (revision) | License | Wrong files caught (of 5) | False alarms (of 46) | MOSS-TTS samples flagged (of 36) |
|---|---|---|---|---|
| Whisper large-v3 (`06f233f`) | Apache-2.0 | 2 | 36 | 4 |
| **Qwen3-ASR-1.7B** (`7278e1e`) | Apache-2.0 | **5** | 12 | 2 |
| FireRedASR2-AED (`2304afe`, code FireRedASR2S `4e7d9aa`) | Apache-2.0 | 4 | 10 | 1 |

- Qwen3-ASR missed none. A false alarm costs a regeneration with another seed, at worst a listen; a miss ships a wrong recording.
- Files all three passed, or all three flagged, were not labelled, and 5 failures is a small sample.
- All three hear MOSS-TTS's isolated 烫 tàng as 胖 pàng.

## Consequences

- Recordings never leave the device.
- Generating audio needs the GPU: about 2–3 s per item on the RX 7900 XTX.
- One engine to maintain, one voice file pinned in the repository.
- Model mirroring is decided in #119.

## Audio packs (#113)

- One pack per referential band, one recording per word reading, built by `tts-packs` and checked as above. Words with several readings (405 words, 874 readings in HSK 2025 and GF0025) get no audio for now: MOSS-TTS reads characters only and cannot be told which reading to say. They are listed in `data/gaps/audio-zh.tsv` until the tone classifier (#115) can check what was said.
- MP3, 48 kbps, mono. Measured on the bake-off words (0.78 s on average): about 5.2 KB per word, against 2.4 KB in Opus at 24 kbps. Opus is fully supported on iOS only since Safari 18.4 ([caniuse](https://caniuse.com/opus), 2026-10-14), and only in CAF before that ([MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)); AAC depends on the system's decoders in Firefox. MP3 plays everywhere.
- Hosting: zip parts of at most 20 MiB attached to a GitHub release, fetched and checked against their sha256 at build time, then served by Cloudflare Pages from `openlinguo.razakk.fr` (CSP unchanged, no third-party request at runtime). Pages serves files up to 25 MiB and 20,000 files per site on the Free plan ([limits](https://developers.cloudflare.com/pages/platform/limits/), 2026-10-14). Committing the packs would add about 100 MB to the repository at each rebuild; GitHub recommends repositories under 1 GB and releases for large binaries ([GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)). R2 behind a Worker route was the alternative, at the cost of Cloudflare configuration.
- License: CC0 1.0. The audio is machine-generated from Apache-2.0 models and a synthetic voice.
- Machine-readable marking (AI Act art. 50(2), applicable since 2 August 2026; checked on the consolidated text of 27 July 2026, after Regulation (EU) 2026/1744): running MOSS-TTS for our own recordings likely makes the project a provider (art. 3(3), « puts the AI system into service under its own name »; art. 3(11), « for own use »). Each MP3 carries ID3 tags, the pack index too: the IPTC digital source type `trainedAlgorithmicMedia` (« Created using Generative AI », [IPTC](https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia)) and a « synthetic voice » note. Metadata is one of the techniques recital 133 lists; it can be stripped, so a robust audio watermark (such as AudioSeal) stays an option if this falls short. Not legal advice.
- `data/audio-zh/packs.json` records the generator, the voice's sha256, the checker, the encoder and the sha256 of the word lists; a test fails when a word list changes after the packs were built.

## Pitch contours (#114)

- One function, `contour()` in `packages/core/src/f0.ts`, for the pipeline now and the browser in #116. pitchy 4.1.0 (MIT) reads 40 ms windows every 10 ms; a frame is voiced when its clarity is at least 0.5 and its level at least 3 % of the loudest frame.
- Clarity 0.5, not pitchy's usual 0.9: on the HSK 1 recordings 0.9 lost the breathy end of falling tones and whole second syllables (联系 xi4). A slope rule on the 73 single-syllable tone 1, 2 and 4 words gets 44 % right at 0.9, 74 % at 0.6, 78 % at 0.5 and 73 % at 0.4. It only checks that the contour carries the tone; the classifier and its fixtures are #115.
- Octaves: candidates in 70–500 Hz; each frame goes to the octave nearest to the previous voiced frame, and a jump of up to 8 semitones is kept as real. 14 % of voiced frames were moved at clarity 0.5 (6 % at 0.9).
- Syllables: no alignment model. The voiced stretch is cut in equal parts, one per spoken syllable (the erhua `r5` is said inside the syllable before it), each boundary moved to the quietest frame within a quarter of a syllable. The learner's voice gets the same cut, so both curves line up.
- Output: 10 points per syllable, in tenths of a semitone relative to the median pitch of the recording, `null` where nothing is voiced. Silence is never bridged. About 17 % of the points are unvoiced on the 256 checked HSK 1 recordings, every one has a voice, and a word takes about 3 ms.
- Shipping: each pack part's `index.json` holds `f0` per recording; `generator.f0` in `packs.json` records `F0_VERSION`. A change of the contour code bumps it and the bands are rebuilt together (the packing guard refuses a mix). The app keeps the contour in its `wordAudio` row.
- Limits: a creaky third tone has few voiced frames, and MOSS gives isolated fourth tones a fall of about half a semitone in some words (下, 二): #115 sets its threshold on human recordings, not on these.
