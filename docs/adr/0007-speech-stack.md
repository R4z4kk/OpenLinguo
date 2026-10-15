# 0007 — Speech stack

- Status: Accepted
- Date: 2026-10-09; Mandarin TTS decided 2026-10-13 (bake-off #112); speech-recognition model hosting and model 2026-10-15 (#119)

## Context

Tone training needs reference audio with an analyzable pitch contour. Browser speech synthesis exposes no audio buffer, so its pitch cannot be analyzed. Voice data must stay on the device.

## Decision

- Reference audio is pre-generated with open neural TTS and served as static files; F0 contours are extracted offline by the pipeline.
- English: Kokoro-82M (Apache-2.0). Kokoro is rejected for Mandarin (all zh voices graded D).
- Mandarin: **MOSS-TTS v1.5** (OpenMOSS, 8B, Apache-2.0) for every recording: syllables, words and sentences.
  - Isolated words are sent with a final 。: without it MOSS-TTS often does not stop (its maintainers' advice for end-of-utterance problems, OpenMOSS/MOSS-TTS#19). Its server caps the length at about 2 s per syllable.
  - It clones `tools/tts/voices/designed-zh-female.wav`, a synthetic voice made by MOSS-VoiceGenerator (Apache-2.0) from a text description: the third of three candidates, as the first spoke too fast for learners and the second too slow. No real person's voice is reproduced, so we read the audio as no deep fake in the sense of the AI Act (art. 3(60): content that "resembles existing persons"; art. 50(4) unchanged by Regulation (EU) 2026/1744). Generated audio is still labelled « synthetic voice » in the app (#113).
- TTS engines run as Docker containers called over HTTP by the TypeScript pipeline (`tools/tts`, `tools/data-pipeline/src/tts`), with pinned commits, model revisions, dependency locks and seeds. They run on the maintainer's Radeon RX 7900 XTX through WSL2: AMD's ROCm 6.4.2 WSL runtime with PyTorch ROCm wheels, tested with the Adrenalin 24.12 driver (AMD certifies WSL only with its "for WSL2" drivers).
- Pitch: one F0 implementation (`pitchy`, MIT) shared by the pipeline and the browser; semitones normalized to the speaker's mean, time-normalized comparison. Raw pitchy contours make octave errors on TTS audio, corrected in #114, and lose weak fundamentals: pitchy reads a low-passed copy (#114, v2).
- STT: **Paraformer-small on sherpa-onnx WebAssembly** in a Web Worker, downloaded on the learner's request (#119, « Faster speech recognition » and « Paraformer in the app », below). It replaced Whisper base via transformers.js on 2026-10-15, too slow on phones. opencc-js still converts traditional output to simplified.
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
- A character reads as any syllable CC-CEDICT gives it, words included: alone, 钥 is only yuè, while 钥匙 is yàoshi.

### Tone of isolated syllables (2026-10-15)

The recognizer checks words, not tones, and no open recognizer outputs toned pinyin. Two weak signals point the same way on the 1,276 single-syllable recordings:

- The character Qwen3-ASR hears for an isolated syllable is chosen from the sound alone: it carries the expected tone for 92 % of the recordings that pass. Its misses lean towards frequent characters (右 heard 有, 移 heard 一), so it cannot decide alone.
- A tone model of this voice (the #115 classifier's features, trained on the recordings whose character agrees) confirms the expected tone for 82 % of its confident answers when the character agrees, 52 % when it does not. On the words reviewed by ear it confidently heard another tone for 4 of the rejected (勿, 愈, 暨, 熨) and agreed with 10 of the 11 accepted.

A syllable is doubted when both point to another tone; it is redone with seeds up to 5. On the packs, 27 were doubted and all found a recording that passes by seed 5. A recording that fails any check with every seed, with no verdict by ear, ships without audio (`unverified` in `data/gaps/audio-zh.tsv`); reviewing by ear is optional. Words of two or more syllables keep the word check only: the recognizer's language model knows the word whatever its tones.

## Consequences

- Recordings never leave the device.
- Generating audio needs the GPU: about 2–3 s per item on the RX 7900 XTX.
- One engine to maintain, one voice file pinned in the repository.
- Speech-recognition models are mirrored on our origin (#119, below).

## Audio packs (#113)

- One pack per referential band, one recording per word reading, built by `tts-packs` and checked as above. Words with several readings (405 words, 874 readings in HSK 2025 and GF0025) get no audio for now: MOSS-TTS reads characters only and cannot be told which reading to say. They are listed in `data/gaps/audio-zh.tsv` until the tone classifier (#115) can check what was said.
- MP3, 48 kbps, mono. Measured on the bake-off words (0.78 s on average): about 5.2 KB per word, against 2.4 KB in Opus at 24 kbps. Opus is fully supported on iOS only since Safari 18.4 ([caniuse](https://caniuse.com/opus), 2026-10-14), and only in CAF before that ([MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)); AAC depends on the system's decoders in Firefox. MP3 plays everywhere.
- Hosting: zip parts of at most 20 MiB attached to a GitHub release, fetched and checked against their sha256 at build time, then served by Cloudflare Pages from `openlinguo.razakk.fr` (CSP unchanged, no third-party request at runtime). Pages serves files up to 25 MiB and 20,000 files per site on the Free plan ([limits](https://developers.cloudflare.com/pages/platform/limits/), 2026-10-14). Committing the packs would add about 100 MB to the repository at each rebuild; GitHub recommends repositories under 1 GB and releases for large binaries ([GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)). R2 behind a Worker route was the alternative, at the cost of Cloudflare configuration.
- License: CC0 1.0. The audio is machine-generated from Apache-2.0 models and a synthetic voice.
- Machine-readable marking (AI Act art. 50(2), applicable since 2 August 2026; checked on the consolidated text of 27 July 2026, after Regulation (EU) 2026/1744): running MOSS-TTS for our own recordings likely makes the project a provider (art. 3(3), « puts the AI system into service under its own name »; art. 3(11), « for own use »). Each MP3 carries ID3 tags, the pack index too: the IPTC digital source type `trainedAlgorithmicMedia` (« Created using Generative AI », [IPTC](https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia)) and a « synthetic voice » note. Metadata is one of the techniques recital 133 lists; it can be stripped, so a robust audio watermark (such as AudioSeal) stays an option if this falls short. Not legal advice.
- `data/audio-zh/packs.json` records the generator, the voice's sha256, the checker, the encoder and the sha256 of the word lists; a test fails when a word list changes after the packs were built.

## Pitch contours (#114)

- One function, `contour()` in `packages/core/src/f0.ts`, for the pipeline now and the browser in #116. pitchy 4.1.0 (MIT) reads 40 ms windows every 10 ms of a low-passed copy of the recording (below); a frame is voiced when its clarity is at least 0.5 and its level at least 3 % of the loudest frame.
- Clarity 0.5, not pitchy's usual 0.9: on the HSK 1 recordings 0.9 lost the breathy end of falling tones and whole second syllables (联系 xi4). A slope rule on the 73 single-syllable tone 1, 2 and 4 words gets 44 % right at 0.9, 74 % at 0.6, 78 % at 0.5 and 73 % at 0.4. It only checks that the contour carries the tone; the classifier and its fixtures are #115.
- Low-pass (`F0_VERSION` v2, 2026-10-15): the mean of the recording is removed, then a one-pole low-pass at 150 Hz feeds pitchy; the level gate reads the centred signal, unfiltered. Without it pitchy misread one Lingua Libre speaker (CanonNi, 546 of the 784 words of #116), for two reasons:
  - It scores every lag up to the window length: at the longest lags the normalised autocorrelation rests on a few samples, can top the true period's peak, and pitchy returns about 25 Hz with a high clarity (dropped as below 70 Hz). That happened on 5 to 10 % of the clear loud frames of every speaker.
  - CanonNi's fundamental sits 15 to 18 dB under his harmonics near the first formant (600–750 Hz; −6.5 dB for the woman, 0 dB for the other man), so pitchy also locked on about 600 Hz, which the octave rule can only halve.
  - DC offset, hum, clipping and sample rate were ruled out; longer windows did worse (60 ms: 49.8 % for the classifier below, 80 ms: 48.1 %).
- What the low-pass changed (classifier of #115, one speaker left out, exact McNemar test): isolated syllables 58.1 → 64.7 % (p = 0.04), syllables of two-syllable words 45.0 → 50.6 % (p = 4·10⁻⁵).
  - Against YIN on clear loud frames of CanonNi's words: 25 Hz frames 9.4 → 6.0 %, harmonic frames 5.5 → 3.4 %.
  - His unvoiced points fall from 28.5 to 18.9 %, and his second-syllable fourth tones fall (−1.05 semitones on average) where they rose (+1.14).
  - Unvoiced points on the 258 HSK 1 recordings go from 16 to 12 %.
- Mean removal: a filter passes DC, which also beats the level gate (167 of the 289 fixtures with no voice at a 10 % offset without it).
- Robustness with both, on the fixtures: a 10 % DC offset, white noise at 20 dB SNR and a 50 or 60 Hz hum at −20 dB stay within about 2 points of the clean figure (64.7 %; 62.6 % with the 60 Hz hum). A hum at −10 dB costs more than with v1 (36.4 % against 42.3 %).
- Options measured and not kept (isolated / in-word classifier figures, #115):
  - a lower clarity: 0.4 gives 60.6 / 44.3 %.
  - a zero-padded window: removes the long lags but lets the first formant win (50.2 / 36.2 %).
  - two filter stages: 65.7 / 51.2 %, not significantly different (p = 0.76 / 0.71), but the voice is lost under mains hum (40 of the 289 fixtures with no voice at 50 Hz, −20 dB).
  - an in-house YIN behind a 300 Hz filter: 70.6 / 50.1 % (p = 0.04 isolated, 0.70 in words against the low-pass kept). It takes 0.87 s for 5 s of audio at 48 kHz, too slow for the 100 ms live curve of #116 without a decimation or an FFT difference function.
  - an in-house capped-lag MPM: 66.1 / 51.7 % (p = 0.68 / 0.49), 10 times slower.
  - one-stage cutoffs of 250 and 300 Hz: as good isolated (66.8 %) but only 47 % in words.
- Cost: the low-pass adds under 1 ms per 5 s of audio at 48 kHz (46.7 ms).
- Octaves: candidates in 70–500 Hz; each frame goes to the octave nearest to the previous voiced frame, and a jump of up to 8 semitones is kept as real. 9 % of voiced frames are moved on the HSK 1 recordings (13 % before the low-pass, 6 % at clarity 0.9 without it).
- Syllables: no alignment model. The voiced stretch is cut in equal parts, one per spoken syllable (the erhua `r5` is said inside the syllable before it), each boundary moved to the quietest frame within a quarter of a syllable. The learner's voice gets the same cut, so both curves line up.
- Output: 10 points per syllable, in tenths of a semitone relative to the median pitch of the recording, `null` where nothing is voiced. Silence is never bridged. About 12 % of the points are unvoiced on the 258 HSK 1 recordings, every one has a voice, and a word takes about 3 ms.
- Shipping: each pack part's `index.json` holds `f0` per recording; `generator.f0` in `packs.json` records `F0_VERSION`. A change of the contour code bumps it and the bands are rebuilt together (the packing guard refuses a mix). The contours come from the cached TTS WAV files, so a rebuild needs no new generation. The app keeps the contour in its `wordAudio` row.
  - With its version: the app's `audio-zh/index.json` carries `generator.f0` as `f0`, stored with each recording. A stored contour is used only when its version is the app's `F0_VERSION`. Otherwise (a pack without contours, made by older contour code, or not yet rebuilt after a change) the app decodes the recording and computes the reference with the same function, offline. No download is forced; recordings stored before the version was kept count as of unknown version.
- Limits: a creaky third tone has few voiced frames, and MOSS gives isolated fourth tones a fall of about half a semitone in some words (下, 二): #115 sets its threshold on human recordings, not on these.

## Tone card (#117)

- A third card type, `tone`, one per reading: hear the word, pick the tone of each syllable (1–4 and neutral), no microphone. It is a stored card like the others, so the review log, backup and replay needed no change; only the readings of `PAIRED_TYPES` (recognition, recall) are still created together.
- Offered once a reading is started (recognition or recall reviewed) and its band's audio pack is installed. The card is stored at its first grade, like a band word's cards. Without the pack's recording it is not offered, due or not: the session counts the cards held back and links to Learn. It plays the pack's recording even when a deck has its own audio.
- It counts in the new cards per day, after the other waiting cards of started words and before new words, as in Anki where every template counts. One card per word and learning day still applies.
- Answer: a syllable is right when the pick is the citation tone or the tone spoken after sandhi (`applySandhi`, the recording says the spoken one). The citation-only rule of the issue would fail a learner who answers what they hear (你好 said *ní hǎo*); both are shown after answering. The erhua `r5` is not a syllable to answer.
- Grade, from the share of right syllables: all → good, at least half → hard, less → again. Never easy: nothing tells how hard it was. The grade is stored when the learner checks; the answer stays on screen until Continue.
- Keyboard: one radio group per syllable (native arrows), keys 1–5 pick the tone of the group in focus and move on, Enter checks; the shortcuts exist only while focus is in the card (WCAG 2.1.4) and the session's grade keys are off for this card. Choices carry the diacritic and the number, the result is text (right or not, expected tone, spoken form), never colour alone.

## Tone classifier (#115)

- `classifyTone(contour)` in `packages/core/src/tone-classifier.ts`: one syllable's 10-point contour (#114) → tone 1–4 and a confidence, deterministic, no network. Four centroids over eleven features (the ten points, unvoiced ones filled in from their neighbours, and the count of unvoiced points: creaky low tones lose frames), each feature in standard deviations; confidence is `1 − d₁/d₂`, the margin over the runner-up. The model, `tone-model.ts`, is trained on the fixtures by `pnpm --filter @openlinguo/data-pipeline tone-model`; a test fails when the two drift. The neutral tone is not classified.
- Fixtures: 289 recordings of one character each (Lingua Libre on Wikimedia Commons, CC0 option of every file), three speakers, one woman (`data/tone-fixtures`, `data/SOURCES.md`). The survey of the category found 16 speakers, 4,117 files, 1,946 with a CC0 option; the isolated ones with one CC-CEDICT reading, no 一/不 and no 3+3 gave 289 over three speakers. Tone Perfect (MSU) would add women: the terms are to be requested.
- Measured with one speaker left out each time, on the low-passed contours (#114, v2): **64.7 % right** on four tones (58.1 % before).
  - By speaker: the woman 71.7 %, the men 73.8 % (Levi Highway) and 49.5 % (CanonNi).
  - CanonNi is the one speaker who drops in isolation (57.6 → 49.5 %, p = 0.17), while his syllables in words gain (43.4 → 48.4 %, p = 0.003).
  - By tone: 94 / 68 / 8 / 78 %.
  - Guesses with a confidence of at least `MIN_CONFIDENCE` = 0.2 are 55.0 % of them and **80.5 % right**. The tone 3 is told almost only by its creak: 2 of 18 confident guesses are right.
- Floors in the tests, in Node and in Chromium and WebKit (the browsers decode the WAV files, the contour and the classifier run on what they return): 60 % right, 48 % kept, 74 % right among those. They are a few points under the measure, and go up when better recordings come.
- What was tried and did not help, on 1,851 syllables of the same speakers (isolated and in two-syllable words): nearest neighbours instead of centroids (63 % isolated), the register relative to the speaker's median, the position in the word, a spread normalisation (+7 points in words on two speakers, +0.3 on three), and more words (546 more, 3.3 times as many). In two-syllable words, each cut in equal parts, **44 to 49 %** with a speaker left out and 59 % for the same speaker on words it never heard (before the low-pass; 50.6 % with it, on the 784 words of #116). The limit is the front end (40 ms frames, equal cut, contour relative to the median), not the volume of recordings.
- Consequences for the app (#116, #118): a word is not graded by a blind four-way guess. #116 measured that the distance to the reference contour tells tones apart worse than the classifier, so it names a tone only from a higher confidence and says « not sure » otherwise (below). Better word-level results need a forced alignment of the syllables or cleaner recordings, and are a later decision.

## Microphone and pitch score (#116)

- On the word page, under the pack recording: say the word, see the pitch of the voice over the recording's, read a result per syllable. Shown once the band's audio is installed and the reading has a tone to say; the listening mode of the tone card (#117, nothing graded) is always one button away (EN 301 549 4.2.6).
- Capture: `getUserMedia` with echo cancellation, noise suppression and automatic gain off (they reshape the pitch), then an `AudioWorklet` served from the app's origin, as `script-src 'self'` requires; Safari has it since 14.1 and iOS 14.5 ([caniuse](https://caniuse.com/mdn-api_audioworklet), 2026-10-15). The audio context is created in the click, before any await, so that Safari lets it run. No library.
- The microphone opens when Record is pressed and closes when the recording ends, when the page is hidden and when the learner leaves it. The samples and both curves stay in memory and are dropped with the next recording: nothing is stored or uploaded (`docs/compliance/data-map.md`). Keeping a recording is #118.
- Live curve: `contour()` runs again on everything recorded every 100 ms, the same function as for the reference, so the curve drawn is the one scored; under reduced motion it appears once the recording ends. A recording stops 0.7 s after the voice (frames under a tenth of the loudest), on Stop, or after 2 s plus 1 s per syllable; nothing loud enough (a muted microphone, or a silent stream after a phone call on iOS) gives « nothing heard ».
- Reference: the contour stored with the pack, or computed in the browser from the MP3 decoded at 16 kHz when the pack predates contours (HSK 1 today, and packs installed before a rebuild).
- Result per syllable, as text: the classifier (#115) on the syllable's ten points against the tone expected after sandhi says « sounds like X, as expected » from a confidence of 0.3, « sounds like Y » for another tone from 0.4, and « not recognised for sure » below; the neutral tone is not judged. The distance to the reference syllable (root mean square, in semitones) follows as the text equivalent of the curve, never as a grade.
- Why the classifier and not the distance: on human recordings (Lingua Libre, CC0) against the HSK 1 pack recordings, how often the expected tone scores better than another one (AUC, 0.5 is chance), one speaker left out for the classifier:

| Signal | Tone 1 | Tone 2 | Tone 3 | Tone 4 | All |
|---|---|---|---|---|---|
| Distance to the reference, isolated (289 syllables, 102 recordings) | 0.89 | 0.73 | 0.47 | 0.69 | 0.64 |
| Classifier margin, isolated | 0.98 | 0.87 | 0.55 | 0.88 | 0.83 |
| Distance to the reference, two-syllable words (784 words, 88 recordings) | 0.78 | 0.58 | 0.46 | 0.52 | 0.60 |
| Classifier margin, two-syllable words | 0.83 | 0.82 | 0.57 | 0.73 | 0.72 |

- A human reference from another speaker does no better than the synthetic voice on isolated syllables (0.61): one noisy curve against another. Inside words the MOSS voice also moves its pitch much more than the speakers (its second-syllable tone 3 sits about 5 semitones under its median, theirs about 0.5). Adding the distance to the classifier's margin helps tone 1 only and lowers the rest.
- Thresholds, each syllable also scored against the three tones it is not (simulated errors): in words, 1 % of wrong syllables get « as expected », 1 % of right ones get another tone, and a tone named is the one said 92 % of the time; 15 % of right syllables get « as expected » (2–3 % for tones 2 and 3), the rest « not recognised for sure ». Isolated: 1 %, 2 % (8 % for tone 3, 5 of 61 syllables) and 32 %. `MIN_CONFIDENCE` (0.2) would tell 4 % of wrong syllables right, 6 % for tone 3. Lowering the thresholds to 0.25 and 0.35 would tell 19 % of right syllables « as expected » in words, for 2 % of each error; they stay at 0.3 and 0.4 because the errors are simulated.
- Limits: real learner errors fall between tones, so the false praise is likely higher than simulated; three speakers; tones from CC-CEDICT, not checked by ear. Measured on the low-passed contours (`F0_VERSION` v2, #114); on v1 the same thresholds gave 2 %, 2 % and 85 % in words.
- Tests: a fake microphone (an oscillator behind `getUserMedia`) drives the end-to-end tests in Chromium and WebKit. The installed iOS web app is checked by hand on a device: home-screen apps long had microphone bugs ([WebKit #185448](https://bugs.webkit.org/show_bug.cgi?id=185448)), and a stream can go silent after a phone call ([WebKit #208209](https://bugs.webkit.org/show_bug.cgi?id=208209)).

## Speech-recognition model hosting (#119)

The model is picked later by the benchmark of #119; this decides where its files come from.

- **Served from `openlinguo.razakk.fr`**, like the audio packs: the model files and the ONNX Runtime WebAssembly binary are copied byte for byte from their pinned upstream (Hugging Face repository revision, npm package version), checked against their sha256 (Hugging Face publishes it for each large file), attached to a GitHub release, fetched and checked at build time, then served by Cloudflare Pages. The browser makes no request outside our origin; `connect-src 'self'` stays as it is.
- **Files above 20 MiB are cut into parts.** Pages serves files of at most 25 MiB ([limits](https://developers.cloudflare.com/pages/platform/limits/), 2026-10-14), and almost no candidate fits (onnx-community conversions, sizes from the Hugging Face API on 2026-10-14):

  | Model | int8 encoder + decoder (WASM) | fp16 encoder + q4 decoder (WebGPU) | Files of 25 MiB or less |
  |---|---|---|---|
  | whisper-tiny | 9.7 + 29.3 MiB | 15.8 + 82.7 MiB | encoders only |
  | whisper-base | 22.1 + 51.2 MiB | 39.4 + 117.9 MiB | int8 encoder only |
  | whisper-small | 88.0 + 149.5 MiB | 168.4 + 222.3 MiB | none |

  `/models/index.json`, written by the build, lists every served file with its size and sha256, and the parts of each cut file. transformers.js 4.3.1 reads every model file through `env.fetch`; in the worker it is replaced by a function that streams a file's parts from the Cache API as one response. With local model paths (`allowRemoteModels` off) transformers.js sends no `Range: bytes=0-0` size probe: it reads `Content-Length`, and the parts of a response nobody reads are never pulled. The files themselves are not converted.
- **The runtime too.** transformers.js loads ONNX Runtime from jsDelivr unless `wasmPaths` is set (`src/backends/onnx.js`); it is set to our origin. Its default build (asyncify: WebAssembly and WebGPU in one binary) is 25.6 MiB in onnxruntime-web 1.31.0-dev.20260914, so it is cut as well. With `useWasmCache` on, transformers.js imports the runtime's JavaScript from a `blob:` URL, which our `script-src 'self'` refuses: it is turned off, and the worker caches the joined binary itself and passes it as `wasm.wasmBinary`. `wasmPaths` names the binary only, so ONNX Runtime uses the JavaScript factory bundled with it (`onnxruntime-web/webgpu`, 118 KB with the factory): no runtime JavaScript is served or fetched. The binary comes from the onnxruntime-web that transformers.js pins (`node_modules`, lockfile integrity), not from the release; the build refuses another version.
- **Prototype** (2026-10-15, Chromium, whisper-tiny int8 at revision `ff41770`, a local server that refuses files above 25 MiB): the decoder and the runtime were each joined from 2 parts and a 1.4 s MOSS-TTS sentence was transcribed (load 0.8 s, run 1.4 s). With the server answering 404 for every part, it ran again from the Cache API; only the runtime's 52 KB JavaScript was fetched (the app bundles it instead, above). Whisper wrote 我們一起去吃飯吧 in traditional characters, as expected: opencc-js stays.
- Rejected:
  - Download from Hugging Face with a notice: the browser would send the learner's IP address, personal data for a site that can identify the person ([Breyer, C-582/14](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62014CJ0582), §49), and the site answers for that transmission ([Fashion ID, C-40/17](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62017CJ0040), ruling 2). Hugging Face, Inc. is not on the [Data Privacy Framework list](https://www.dataprivacyframework.gov/list) (checked 2026-10-14) and its [privacy policy](https://huggingface.co/privacy) (2023-03-28) names no art. 46 safeguard. It would need consent, which ADR 0009 avoids, a CSP opened to `huggingface.co` and `*.hf.co` (Hugging Face warns its download hosts change), and anonymous downloads share 3,000 resolver requests per 5 minutes per IP address ([rate limits](https://huggingface.co/docs/hub/rate-limits)), a whole school behind one address included.
  - R2 behind a Pages Function on `/models/*`: whole files on the same origin, but R2 needs a payment method on the account, every request counts in the Workers Free plan's 100,000 a day, cache hits included ([pricing](https://developers.cloudflare.com/pages/functions/pricing/)), and past that the fail-open setting serves static files instead, and the CI needs upload credentials.
  - R2 custom domain or a Worker route: both need the `razakk.fr` zone on Cloudflare; its DNS is at OVH, and a partial (CNAME) setup is for Business and Enterprise plans ([R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)).
  - GitHub release assets fetched by the browser: the redirect from `github.com` carries no `Access-Control-Allow-Origin`.
  - The maintainer's own server: another origin (CORS, CSP), and a home connection's upload for downloads of 40 to 400 MiB.
- Open: Cloudflare's terms let it limit Free, Pro and Business CDN use that serves a disproportionate share of large files, except through Developer Platform services, Pages and R2 among them ([service-specific terms](https://www.cloudflare.com/service-specific-terms-application-services/), 2026-09-28); they do not say whether the Free plan of those services counts. If Pages limits the files, R2 behind a Pages Function takes over and the client stays the same.
- License: the Whisper weights are MIT (OpenAI, [openai/whisper](https://github.com/openai/whisper)); the onnx-community conversions declare none. The notice ships with the mirrored files and the chosen model goes in `data/SOURCES.md`.

## Speech-recognition model (#119)

- **Whisper base** ([onnx-community/whisper-base](https://huggingface.co/onnx-community/whisper-base) at `1846881`, chosen by the maintainer from the table below): `encoder_model_fp16` and `decoder_model_merged_fp16` on WebGPU when the device has an adapter with `shader-f16`, the int8 pair (`_quantized`) on WebAssembly otherwise. A device downloads one set: 168 MiB with WebGPU, 102 MiB without, the ONNX Runtime binary (25.6 MiB) and the tokenizer included; the site serves both.
- Benchmark (2026-10-15): transformers.js 4.3.1, onnxruntime-web 1.31.0-dev.20260914 (asyncify), language forced to Chinese, greedy decoding, files from our origin as the app loads them. Desktop: Chrome 155 on an Intel i7-13700KF with a Radeon RX 7900 XTX; WebAssembly on one thread (the app was not cross-origin isolated yet: threads below). Phone: the maintainer's Android 10 phone (Qualcomm Adreno 6xx GPU), Chrome 155, the same page served over HTTPS on the local network, first 10 sentences and 10 words (5 sentences on WebGPU).
- Fixtures: 50 sentences of [FLEURS](https://huggingface.co/datasets/google/fleurs) `cmn_hans_cn` dev (Google, CC BY 4.0; read Wikipedia sentences, the first 50 sentence ids of at most 10 s, one recording each, 7.8 s on average), the 289 tone fixtures (human, one character each, CC0), the 258 words of the HSK 1 pack (MOSS-TTS). Transcripts converted by opencc-js (`tw` → `cn`) and cut as the app caps them (below). CER on Han characters, digits read as characters; the syllable error rate counts a homophone as right (CC-CEDICT readings, tones aside), which is what the app shows as « heard as expected »; for words and characters, the share of items heard right in full, homophones accepted. The table gives the first 50 items of each set for every configuration (WebAssembly takes seconds per item); times are medians over the items that did not loop. Run on all 597 items, WebGPU heard 45 % (tiny), 63 % (base) and 70 % (small) of the 258 words and 42, 45 and 57 % of the 289 characters right.

| Model, backend | Download per device | FLEURS CER / syllables | HSK 1 words | Characters | Load (cached) | Sentence (7.8 s) | Word |
|---|---|---|---|---|---|---|---|
| tiny, WASM int8 | 67 MiB | 48 % / 36 % | 34 % | 26 % | 0.4 s | 1.2 s | 0.8 s |
| tiny, WebGPU fp16 | 101 MiB | 23 % / 11 % | 52 % | 36 % | 0.4 s | 0.45 s | 0.15 s |
| **base, WASM int8** | **102 MiB** | **19 % / 10 %** | **62 %** | **36 %** | **0.5 s** | **2.4 s** | **3.1 s** |
| **base, WebGPU fp16** | **168 MiB** | **17 % / 8 %** | **62 %** | **38 %** | **1.1 s** | **0.8 s** | **0.26 s** |
| small, WASM int8 | 266 MiB | 10 % / 5 % | 76 % | 52 % | 1.7 s | 14 s | 11 s |
| small, WebGPU fp16 + q4 | 419 MiB | 9 % / 5 % | 78 % | 48 % | 3.8 s | 1.2 s | 0.35 s |
| base on the phone, WASM int8 | 102 MiB | 13 % / 6 % | 60 % | | 2–4 s | 12 s | 10 s |
| base on the phone, WASM int8, 2 threads | 102 MiB | same transcripts | | | 2.7–3.1 s | 13 s | 8–10 s |
| base on the phone, WebGPU fp16 | 168 MiB | 88–95 % / 86–94 %: nonsense | | | 3.2–3.5 s | 2.9 s | |

- Downloads: the onnx-community `q4` decoders keep their embeddings and output layer in full precision, so they are larger than the fp16 ones up to base (tiny 82.7 against 56.8 MiB, base 117.9 against 99.9 MiB) for the same accuracy: WebGPU uses fp16.
- tiny int8 falls into loops (one syllable repeated until the cap) on most sentences. small is the most accurate, but 419 MiB with WebGPU and 14 s a sentence on one desktop thread, too slow for a phone without WebGPU.
- On the phone, WebGPU is four times faster than WebAssembly but writes nonsense (很快被環码裝備的警察進入了院的兴的 for 很快，配备了防暴装备的警察进入了院子…), from the same files that are right on the desktop: some mobile GPUs get fp16 wrong. Hence the self-check below. On WebAssembly the phone needed 12 s a sentence on one thread, far from instant; threads (« Cross-origin isolation », below) do not help there: the phone reports 4 logical cores, ONNX Runtime then takes 2 threads (`min(4, ⌈cores / 2⌉)`), and a sentence still took 12.5–13.2 s, a word 8.4–10.2 s, with the same transcripts (2 runs of 5 sentences and 5 words). A faster kind of engine (non-autoregressive Mandarin models) is being benchmarked.
- Every model mishears words said alone: the best heard 70 % of the clean synthetic words and 57 % of the human characters right. Whisper always encodes 30 s of audio, so a word costs about as much as a sentence. Hence the word page shows Whisper's transcript as a hint only, and sentences are checked on the Read page (below).
- Threads: cross-origin isolated (COOP and COEP headers), ONNX Runtime runs WebAssembly on 4 threads. On the desktop base then took 1.1 s a sentence and 0.5 s a word, small 3.0 s and 1.8 s (first 10 items of each), 2 to 5 times faster than on one thread. The app is now cross-origin isolated (« Cross-origin isolation », below).
- The harness (a static page loading the model as the worker does, a scorer) and the raw transcripts are not in the repository; FLEURS audio is not redistributed.

## Speech recognition in the app (#119)

The engine below is Whisper as first shipped (#131). Its worker, CSP rules, cross-origin isolation, WebGPU self-check, runtime and `max_new_tokens` were replaced on 2026-10-15 (« Paraformer in the app », below); the pages, the recording, the result, consent and storage hold.

- **Read page, « Read aloud »**: the learner types or pastes a sentence (up to 60 characters, 30 s of speech), reads it aloud and sees what was heard. **Word page, under « Say it »**: the same recording that gets the pitch score is transcribed, shown as a hint, once the model is downloaded; otherwise a link to the Read page offers it. Both places were the maintainer's choice, the word page's result marked as a hint.
- Recording: as in #116 (microphone opened on Record only, raw voice, stops 0.7 s after the voice, on Stop or after the time limit, dropped when the page is hidden); the samples are resampled to 16 kHz by an `OfflineAudioContext` and sent to the worker, then dropped with the next recording.
- Result, as text: the transcript in simplified characters; how many characters were heard as expected; then each difference: « 饭 fàn: heard as 反 (fan), the same syllable », « not heard », « also heard ». The transcript is segmented with the dictionary and each character carries every syllable CC-CEDICT reads it as in its word (alone when the word has no reading); an edit-distance alignment makes a homophone cheaper than another character, so homophones line up. The expected pinyin keeps its tones, the heard one has none: Whisper does not judge tones, the pitch module does, as the page says.
- `max_new_tokens` is two per expected character plus ten (at most 200): Whisper can repeat a token until its limit.
- **Consent and storage**: before « Download speech recognition (size) » only `/models/index.json` (4 KB) is fetched, for the size. The parts are fetched, checked against their sha256 and stored in the Cache API (`speech-model-<release>`) one by one, so a cancelled or failed download resumes at the next part; installing a new release deletes the older one. « Delete speech recognition » removes every release. The index is stored with the files, and the worker's JavaScript is precached by the service worker, so the feature works offline. A failed download, a file missing at load time and a failed transcription are each shown.
- **Worker**: its `onmessage` is set before anything is awaited and transformers.js is imported on the first request, so a message sent while the module loads is not lost. `allowLocalModels` on, `allowRemoteModels` off, `localModelPath` `/models/`, `useBrowserCache` off (the files are already in our cache), `useWasmCache` off, `numThreads` left to ONNX Runtime: 1 unless the page is cross-origin isolated, then min(4, ⌈logical cores / 2⌉) (`onnxruntime-web` `lib/backend-wasm.ts`). `env.fetch` reads the Cache API only, never the network: a model deleted from another tab fails to load instead of being fetched without consent.
- **CSP**: `'wasm-unsafe-eval'` is in the policy of the worker's script and of ONNX Runtime's thread workers only. Those run the chunk transformers.js is bundled in (`new Worker(new URL(import.meta.url), { name: "em-pthread" })` in the runtime's factory, `/assets/transformers.web-*` once built). `/assets/speech-worker-*` and `/assets/transformers.web-*` in `public/_headers` each detach the site-wide policy and set their own: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'`. It allows compiling WebAssembly, not JavaScript `eval` ([CSP3](https://www.w3.org/TR/CSP3/#grammardef-wasm-unsafe-eval)). A dedicated worker is governed by the policy delivered with its script, not the page's: checked on 2026-10-15 in Chromium 153 and WebKit 26.6, where WebAssembly compiles in such a worker and not in the page. A thread worker only instantiates the module compiled by the speech worker: Chromium 153 allows that under `script-src 'self'`, WebKit 26.6 refuses it, and without the second rule the model fails to load in WebKit (an error per thread, shown as a failed load). Pages applies every matching rule in order, its detached headers then its own (`@cloudflare/pages-shared` 0.13.197, `asset-server/handler.ts`); `vite preview` applies the same rules (`apps/web/vite.config.ts`), and a unit test checks that the pages keep `script-src 'self'` and that both rules apply.
- **Cross-origin isolation** (COOP `same-origin` and COEP `require-corp` on every path, maintainer's choice on 2026-10-15): ONNX Runtime's threads need `SharedArrayBuffer`, which needs it. COEP refuses cross-origin responses that carry no CORP or CORS; the CSP already allows nothing but our origin and the `blob:` URLs the app creates, so nothing the app loads is refused (e2e suite in Chromium and WebKit). A dedicated worker's script must send COEP itself ([HTML, « check a global object's embedder policy »](https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy)): the `/*` rule gives it to every file, and a worker script without it does not load (Chromium 153, WebKit 26.6). `credentialless` would do as well for our own files, but WebKit 26.6 leaves the page not isolated with it, and browser-compat-data lists no Safari support. Support ([browser-compat-data](https://github.com/mdn/browser-compat-data), 2026-10-15): COEP in Chrome 83, Firefox 79 and Safari 15.2; `crossOriginIsolated` in Chrome 87, Firefox 72 and Safari 15.2; a worker started from a worker in Safari 16.4, the oldest Safari of Vite 8's default build target (`baseline-widely-available`). The read-aloud e2e checks that the page is isolated.
- Measured in the read-aloud flow on the desktop above (the e2e's fake microphone, WebGPU hidden so base runs on WebAssembly int8; time from the request to the worker's reply, median of 4; Linux rows in the Playwright image on the same machine; ONNX Runtime took 4 threads in each). The model loads from the cache in about 1 s either way.

| Browser | Sentence (1.4 s, MOSS-TTS), 1 → 4 threads | One character (Lingua Libre), 1 → 4 threads |
|---|---|---|
| Chromium 153, Windows | 1.83 → 0.63 s | 1.71 → 0.54 s |
| Chromium 153, Linux | 1.88 → 0.66 s | 1.78 → 0.58 s |
| WebKit 26.6, Linux | 1.90 → 0.70 s | 1.77 → 0.60 s |

- The service worker keeps each precached file with the headers it was fetched with until the file's content changes. This change ships in the same deploy as the speech worker (#131), so no precached `transformers.web-*` chunk lacks COEP; a later header change reaches an unchanged file only when its precache revision changes.
- **WebGPU self-check**: before WebGPU is trusted on a device, the worker transcribes a known sentence (`data/whisper/self-check.wav`, 我们一起去吃饭吧, MOSS-TTS, 66 KB, downloaded with the WebGPU files), once per release. With fewer than 3 in 4 characters right, WebGPU is set aside on that device (`localStorage`), its own files are deleted, the page says why and offers the WebAssembly version. It costs 2.5 s once on the desktop, load included; WebAssembly is not checked.
- **Pages limit**: the build fails if any file it outputs is above 25 MiB.
- **Optional** (EN 301 549 4.2.6): nothing else in the app needs a voice; the Read aloud section says so, and the word page keeps the tone card's listening mode one button away (#116).
- Runtime: one binary, the asyncify build transformers.js uses by default, for both backends. transformers.js switches to the plain build on Safari before 26 without WebGPU, after memory crashes on iOS ([huggingface/transformers.js#1242](https://github.com/huggingface/transformers.js/issues/1242)); the tests run WebKit 26, so iOS 18 and older stay to check on a device.

## Faster speech recognition (#119, option B)

- Status: decided 2026-10-15 by the maintainer from the table below: **Paraformer-small on sherpa-onnx WebAssembly**, replacing Whisper.
- Why: Whisper base takes 12 s a sentence and 10 s a word on the maintainer's phone on WebAssembly, and WebGPU writes nonsense there (above). Whisper decodes token by token over 30 s of audio. The models below are Mandarin models that read the whole recording at once (non-autoregressive or CTC), so a word costs a fraction of a sentence.
- Runtime: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (k2-fsa, Apache-2.0) compiled to WebAssembly: one thread, SIMD, 11.2 MiB binary (ONNX Runtime's is 25.6 MiB). The benchmark used the binaries of k2-fsa's own demo Space `k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc` at `9d5fc71` (sherpa-onnx 1.12, March 2026), and for the two streaming models a byte-identical copy of its streaming demo (`yumu908/web-assembly-asr-sherpa-onnx-zh-en` at `b4b3bd8`; the original Space is no longer public).
- CSP: it ran under the app's policies, served as the app serves them: page `default-src 'self'; script-src 'self'`, worker the same plus `'wasm-unsafe-eval'`. The glue has no `eval`, no `new Function`, no `blob:` worker. It is a classic script, loaded with `importScripts` in a classic worker; the demo's 367 MB preloaded `.data` was skipped and the model files written into its file system from the Cache API.
- Benchmark (2026-10-15): the fixtures and scoring of the Whisper benchmark above (first 50 items per set; all 258 words and 289 characters in brackets), int8 models from our origin through the Cache API, greedy decoding, SenseVoice with language `zh` and no text normalisation. Desktop: Chrome 155 on the i7-13700KF, one pass for all timings (another pass gave up to 60 % slower desktop times, same transcripts). Phone: the maintainer's Android 10 phone (4 cores reported), Chrome 155, over HTTPS on the local network; its transcripts were identical to the desktop's for every model (150 of 150).

| Model (sherpa-onnx int8 export) | Weights license | Download | FLEURS CER / syllables | HSK 1 words | Characters | Desktop: load / sentence / word | Phone: load / sentence / word |
|---|---|---|---|---|---|---|---|
| Paraformer-small (FunASR) | Apache-2.0 | 78 MiB | 5.4 % / 3.2 % | 98 % (89.5 %) | 84 % (81.0 %) | 0.8 / 0.46 / 0.05 s | 3.4 / 1.5 / 0.14 s |
| Streaming Zipformer small CTC (k2-fsa, 2025-04-01) | Apache-2.0 | 25 MiB | 8.7 % / 5.4 % | 94 % (89.5 %) | 84 % (78.5 %) | 1.1 / 0.66 / 0.05 s | 3.1 / 1.6 / 0.13 s |
| Zipformer CTC small (k2-fsa, 2025-07-16) | none stated | 60 MiB | 3.8 % / 2.7 % | 96 % (91.1 %) | 86 % (84.1 %) | 3.4 / 0.63 / 0.06 s | 9.0 / 1.6 / 0.16 s |
| Paraformer-large (FunASR) | Apache-2.0 | 217 MiB | 4.3 % / 2.8 % | 98 % (91.9 %) | 84 % (77.2 %) | 2.0 / 1.27 / 0.13 s | 4.5–6.0 / 4.5 / 0.43 s |
| SenseVoice-small (FunAudioLLM) | Apache-2.0 or FunASR model licence: the cards disagree | 228 MiB | 4.5 % / 2.8 % | 100 % (93.4 %) | 94 % (88.2 %) | 1.5 / 1.80 / 0.21 s | 4.9 / 6.3 / 0.70 s |
| Zipformer CTC (k2-fsa, 2025-07-03) | none stated | 350 MiB | 3.3 % / 2.6 % | 90 % (89.1 %) | 86 % (84.8 %) | 5.5 / 2.18 / 0.23 s | not run: 1 GiB of memory |
| Dolphin base CTC (DataoceanAI) | Apache-2.0 | 99 MiB | 9.1 % / 5.7 % | 80 % (82.6 %) | 52 % (46.7 %) | 0.5 / 1.79 / 0.14 s | not run |
| Streaming Zipformer 14M (k2-fsa, 2023) | Apache-2.0 | 30 MiB | 11.3 % / 7.3 % | 88 % (86.0 %) | 60 % (66.4 %) | 1.5 / 0.49 / 0.05 s | not run |
| Whisper base, WASM int8 (above) | MIT | 102 MiB | 19 % / 10 % | 62 % | 36 % | 0.5 / 2.4 / 3.1 s | 2–4 / 12 / 10 s |

- They write simplified characters: opencc changes none of the ~2,000 characters of each, but 1 for the streaming Zipformer and 7 for Dolphin. Whisper base needed it for 19 %.
- Downloads are the model alone; the runtime adds 11.2 MiB, against 25.6 MiB for ONNX Runtime. Load is from the Cache API; starting the runtime itself (fetching and compiling the 11.2 MiB binary, uncached in the benchmark) took 3–6.5 s on the phone, so the worker would start when the page opens.
- Memory: 512 MiB of WebAssembly memory from the start (the demo build's setting), 610 MiB for the two 220 MiB models, 1 GiB for the 350 MiB one.
- Sentence times are for FLEURS's 7.8 s on average; time grows with the audio (phone: 0.19 s per second of speech for Paraformer-small), so a 3 s learner sentence takes about 0.6 s.
- Licenses, read from the files on 2026-10-15:
  - Paraformer-small and -large: Apache-2.0 on ModelScope (`iic/speech_paraformer_asr_nat-zh-cn-16k-common-vocab8358-tensorflow1`, `iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8358-tensorflow1`); trained on « tens of thousands of hours of industrial labelled audio » (model card). The small ONNX export was made by a third party (`crazyant/...-onnx` on ModelScope) and copied by sherpa-onnx; neither copy states a license. Apache-2.0 allows the derivative; for a clean chain the original `model.pt` (sha256 `e8e666e6…`) can be exported again with FunASR's tools.
  - SenseVoice-small: the ModelScope card says Apache-2.0, the Hugging Face card the [FunASR Model Open Source License 1.1](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE) (use and share with attribution, but « denigration » ends the licence, and revisions apply automatically). The sherpa-onnx export points to FunASR's README, which points back to the card.
  - Zipformer CTC small and large: no license on the exports, training data not stated. The streaming small model's source checkpoint is Apache-2.0. Many Chinese Zipformers train on WenetSpeech, « available to download for non-commercial purposes under CC BY 4.0 » from YouTube and podcasts.
- Excluded without running: Moonshine tiny-zh (Moonshine AI Community License: revocable, free under US $1M revenue), TeleSpeech (custom licence), FireRedASR, Qwen3-ASR and Fun-ASR-Nano (0.8 GB and more), and the 2025 SenseVoice and Paraformer exports in sherpa-onnx (Cantonese and Sichuanese fine-tunes).
- Paraformer-large and SenseVoice miss the « about a second » goal on the phone (4.5 and 6.3 s a sentence). SenseVoice hears isolated characters best (88 % against 81 %).
- **Paraformer-small**, the maintainer's choice: on the phone it is 8 times faster than Whisper on a sentence and 70 times on a word, with under a third of its errors (CER 5.4 % against 19 %; all words 89.5 % against 63 % and all characters 81 % against 45 % for base on WebGPU). It is Apache-2.0, smaller (78 MiB) and needs no WebGPU, so no GPU self-check. Runners-up: the streaming Zipformer if size or live text mattered more (25 MiB, slightly less accurate), the Zipformer CTC small if its authors stated a license and its 9 s first load were acceptable.
- **Runtime, the maintainer's choice**: sherpa-onnx built from a pinned release without the demo's preloaded data, as measured here; not ONNX Runtime with the feature extraction rewritten in TypeScript. How Whisper and transformers.js leave the app is left to the implementation.
- The harness (pinned downloads with sha256, a page and worker under the app's CSP, the Whisper scorer) and the raw transcripts are not in the repository.

## Paraformer in the app (#119)

- **Build** (`tools/sherpa-onnx/Dockerfile`, maintainer's choices on 2026-10-15): sherpa-onnx **v1.13.8** (`11afbd0`, the latest release; it links ONNX Runtime 1.28.2, where the benchmark's 1.12 build had 1.17.1), compiled in the `emscripten/emsdk:4.0.23` image pinned by digest, the version sherpa-onnx's scripts name. Offline recognition only (no TTS, no diarization), one thread, no preloaded file, an ES module factory for a module worker (`MODULARIZE`, `EXPORT_ES6`, `ENVIRONMENT=worker`), `DYNAMIC_EXECUTION=0` (no `eval`, no `new Function`). 13.0 MiB of WebAssembly and 71 KB of JavaScript; a build without cache gave the same sha256 (2026-10-15).
- `tools/sherpa-onnx/openlinguo-asr.c` fills the recognizer's configuration in C (Paraformer, 16 kHz, 80 features, greedy search, one thread), so the worker passes only paths and samples and never the layout of sherpa-onnx's C structs. Three functions are exported with `malloc` and `free`.
- **Memory**: Paraformer-small peaks at 133 MiB of WebAssembly memory over the 597 fixtures; the build starts at 160 MiB and may grow (the demo build reserves 512 MiB).
- **This build** (2026-10-15, the fixtures and scorer of « Faster speech recognition »): FLEURS CER 5.0 % / syllables 3.0 %, HSK 1 words 98 % (all 258: 92.6 %), characters 80 % (all 289: 81.3 %), against 5.4 % / 3.2 %, 98 % (89.5 %) and 84 % (81.0 %) for the 1.12 build; the same transcripts as the sherpa-onnx 1.13.8 npm package in Node, and in Chrome as in Node (150 of 150). Desktop Chrome, files from the Cache API as the app reads them: start 0.81 s (model 0.78 s), sentence 0.24 s, word 0.03 s (medians; the 1.12 build: 0.82 / 0.46 / 0.05 s). Phone: to measure.
- **Files** (`data/paraformer/model.json`, release `paraformer-1`, written by `pnpm --filter @openlinguo/data-pipeline paraformer`): `model.int8.onnx` and `tokens.txt` of `csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09` at `63ddc3c`, byte for byte, checked against the hashes Hugging Face publishes (the maintainer kept this export rather than exporting ModelScope's `model.pt` again), and the build's binary, checked against its `SHA256SUMS`. 91.2 MiB to download (Whisper base: 102 MiB on WebAssembly, 168 MiB on WebGPU); the model is served in 4 parts. The JavaScript is committed in `apps/web/src/lib/sherpa-onnx/` and bundled in the worker; the build refuses it unless it matches the sha256 recorded with the binary.
- **Worker**: the binary is read from the Cache API and given to the factory (`wasmBinary`); the model and tokens are written to Emscripten's in-memory file system, the recognizer is created, then the files are removed, as the recognizer holds its own copy. Nothing is fetched. A transcription copies the 16 kHz samples in and the text out.
- **Start**: one worker per tab, started when the Read page or a word page opens with the model stored (a phone took 3–6.5 s to start the runtime in the benchmark) and kept while the learner moves between pages; it stops when the model is deleted or replaced, and after a failure, the next use starting it again.
- **CSP**: `'wasm-unsafe-eval'` stays on `/assets/speech-worker-*` only; the rule for transformers.js's thread workers is gone.
- **Cross-origin isolation removed** (maintainer, 2026-10-15): one thread needs no `SharedArrayBuffer`. COEP is gone; COOP `same-origin` stays, as before #133.
- **Removed**: transformers.js and its ONNX Runtime binary, WebGPU and its self-check (the recording is now an e2e fixture), `max_new_tokens` (Paraformer reads the recording at once and cannot loop).
- **Licenses**: the build writes `THIRD-PARTY-LICENSES.txt` (`data/paraformer/`, served under `/data/licenses/paraformer/`): sherpa-onnx (Apache-2.0), every library its CMake files download (kaldi-native-fbank, kaldi-decoder, kaldifst, OpenFst, simple-sentencepiece: Apache-2.0; kissfft: BSD-3-Clause; nlohmann/json: MIT; Eigen: MPL-2.0, whose source archive the pinned `cmake/eigen.cmake` names), ONNX Runtime 1.28.2 (MIT) with its third-party notices, and Emscripten's runtime. The model is Apache-2.0 (Tongyi Lab, Alibaba, on ModelScope), credited in the app.
