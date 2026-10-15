# 0007 — Speech stack

- Status: Accepted
- Date: 2026-10-09; Mandarin TTS decided 2026-10-13 (bake-off #112); speech-recognition model hosting 2026-10-15 (#119)

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
- Speech-recognition models are mirrored on our origin (#119, below).

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
- Measured with one speaker left out each time: **58.1 % right** on four tones (female speaker 55.7 %, male 57.6 % and 61.9 %); by tone 94 / 61 / 20 / 56 %. Guesses with a confidence of at least `MIN_CONFIDENCE` = 0.2 are 42.9 % of them and **77.4 % right**. The tone 3 is told almost only by its creak: 2 of 16 confident guesses are right.
- Floors in the tests, in Node and in Chromium and WebKit (the browsers decode the WAV files, the contour and the classifier run on what they return): 53 % right, 35 % kept, 70 % right among those. They are a few points under the measure, and go up when better recordings come.
- What was tried and did not help, on 1,851 syllables of the same speakers (isolated and in two-syllable words): nearest neighbours instead of centroids (63 % isolated), the register relative to the speaker's median, the position in the word, a spread normalisation (+7 points in words on two speakers, +0.3 on three), and more words (546 more, 3.3 times as many). In two-syllable words, each cut in equal parts, **44 to 49 %** with a speaker left out and 59 % for the same speaker on words it never heard. The limit is the front end (40 ms frames, equal cut, contour relative to the median), not the volume of recordings.
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
| Distance to the reference, isolated (289 syllables, 102 recordings) | 0.91 | 0.64 | 0.38 | 0.56 | 0.56 |
| Classifier margin, isolated | 0.96 | 0.87 | 0.58 | 0.83 | 0.80 |
| Distance to the reference, two-syllable words (784 words, 88 recordings) | 0.80 | 0.54 | 0.44 | 0.49 | 0.57 |
| Classifier margin, two-syllable words | 0.79 | 0.77 | 0.54 | 0.69 | 0.69 |

- A human reference from another speaker does no better than the synthetic voice on isolated syllables (0.55): one noisy curve against another. Inside words the MOSS voice also moves its pitch much more than the speakers (its second-syllable tone 3 sits about 4.5 semitones under its median, theirs about 0.5). Adding the distance to the classifier's margin helps tone 1 only and lowers the rest.
- Thresholds, each syllable also scored against the three tones it is not (simulated errors): in words, 2 % of wrong syllables get « as expected », 2 % of right ones get another tone, and a tone named is the one said 85 % of the time; 14 % of right syllables get « as expected » (0–2 % for tones 2 and 3), the rest « not recognised for sure ». Isolated: 1 %, 2 % and 27 %. `MIN_CONFIDENCE` (0.2) would tell 4 % of wrong syllables right, 8 % for tone 3.
- Limits: real learner errors fall between tones, so the false praise is likely higher than simulated; three speakers; tones from CC-CEDICT, not checked by ear. pitchy misreads the speaker of 70 % of the words (frames near 25 or 600 Hz with a high clarity where YIN finds 100–165 Hz; 29 % unvoiced points against 11 %), which lowers every word figure: a matter for the F0 module (#114).
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

  A `parts.json` lists each cut file with its parts, size and sha256. transformers.js 4.3.1 downloads every model and runtime file through `env.fetch`; in the worker it is replaced by a function that streams the parts of a listed file as one response, and answers the `Range: bytes=0-0` size probe from `parts.json`. The files themselves are not converted.
- **The runtime too.** transformers.js loads ONNX Runtime from jsDelivr unless `wasmPaths` is set (`src/backends/onnx.js`); it is set to our origin. Its default build (asyncify: WebAssembly and WebGPU in one binary) is 25.6 MiB in onnxruntime-web 1.31.0-dev.20260914, so it is cut as well. With `useWasmCache` on, transformers.js imports the runtime's JavaScript from a `blob:` URL, which our `script-src 'self'` refuses: it is turned off, and the worker caches the joined binary itself and passes it as `wasm.wasmBinary`. The `wasm-unsafe-eval` change stays to document in #119.
- **Prototype** (2026-10-15, Chromium, whisper-tiny int8 at revision `ff41770`, a local server that refuses files above 25 MiB): the decoder and the runtime were each joined from 2 parts and a 1.4 s MOSS-TTS sentence was transcribed (load 0.8 s, run 1.4 s). With the server answering 404 for every part, it ran again from the Cache API; only the runtime's 52 KB JavaScript was fetched, which the app's service worker will serve. Whisper wrote 我們一起去吃飯吧 in traditional characters, as expected: opencc-js stays.
- Rejected:
  - Download from Hugging Face with a notice: the browser would send the learner's IP address, personal data for a site that can identify the person ([Breyer, C-582/14](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62014CJ0582), §49), and the site answers for that transmission ([Fashion ID, C-40/17](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62017CJ0040), ruling 2). Hugging Face, Inc. is not on the [Data Privacy Framework list](https://www.dataprivacyframework.gov/list) (checked 2026-10-14) and its [privacy policy](https://huggingface.co/privacy) (2023-03-28) names no art. 46 safeguard. It would need consent, which ADR 0009 avoids, a CSP opened to `huggingface.co` and `*.hf.co` (Hugging Face warns its download hosts change), and anonymous downloads share 3,000 resolver requests per 5 minutes per IP address ([rate limits](https://huggingface.co/docs/hub/rate-limits)), a whole school behind one address included.
  - R2 behind a Pages Function on `/models/*`: whole files on the same origin, but R2 needs a payment method on the account, every request counts in the Workers Free plan's 100,000 a day, cache hits included ([pricing](https://developers.cloudflare.com/pages/functions/pricing/)), and past that the fail-open setting serves static files instead, and the CI needs upload credentials.
  - R2 custom domain or a Worker route: both need the `razakk.fr` zone on Cloudflare; its DNS is at OVH, and a partial (CNAME) setup is for Business and Enterprise plans ([R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)).
  - GitHub release assets fetched by the browser: the redirect from `github.com` carries no `Access-Control-Allow-Origin`.
  - The maintainer's own server: another origin (CORS, CSP), and a home connection's upload for downloads of 40 to 400 MiB.
- Open: Cloudflare's terms let it limit Free, Pro and Business CDN use that serves a disproportionate share of large files, except through Developer Platform services, Pages and R2 among them ([service-specific terms](https://www.cloudflare.com/service-specific-terms-application-services/), 2026-09-28); they do not say whether the Free plan of those services counts. If Pages limits the files, R2 behind a Pages Function takes over and the client stays the same.
- License: the Whisper weights are MIT (OpenAI, [openai/whisper](https://github.com/openai/whisper)); the onnx-community conversions declare none. The notice ships with the mirrored files and the chosen model goes in `data/SOURCES.md`.
