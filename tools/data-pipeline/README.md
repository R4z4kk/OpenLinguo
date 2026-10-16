# @openlinguo/data-pipeline

Downloads datasets from pinned URLs, verifies them against the sha256 recorded in `data/manifest.json`, and writes compact shards to `data/<dataset>/`. Raw sources are kept in memory and never written to the repository.

```bash
pnpm --filter @openlinguo/data-pipeline pipeline cc-cedict
```

- Without `--refresh`, a dataset whose upstream file changed fails with a checksum mismatch. Nothing is rebuilt.
- With `--refresh`, the new checksum and retrieval date are pinned, the shards rebuilt, and the row diff printed. The result goes through a reviewed pull request; it is never merged automatically.
- `data/<dataset>/` is fully generated (shards and attribution README); do not edit it by hand.
- A build may read datasets built before it (`cfdict` joins onto `cc-cedict` shards, each fallback font reads the `missing.tsv` of the fonts before it); running every dataset follows the registry order in `src/cli.ts`.

## Freshness

```bash
pnpm data:freshness
```

CI fails when a dataset is older than its `maxAgeDays` or has a `retrievedAt` in the future. The `data-refresh` workflow runs monthly (or on demand): it refreshes every dataset, pushes a `data/refresh-*` branch and opens an issue with the diff stats and a link to open the pull request. A failed refresh opens an issue too.

## Mandarin TTS

MOSS-TTS v1.5 generates every Mandarin recording (ADR 0007). It runs as a Docker container on the Radeon through WSL2 (`tools/tts/compose.yaml`, port on localhost only); models are downloaded at their pinned revision on first start.

```bash
docker build -t openlinguo-rocm-wsl:6.4.2 tools/tts/rocm-wsl
docker compose -f tools/tts/compose.yaml up -d moss-tts
pnpm --filter @openlinguo/data-pipeline tts-bakeoff generate
pnpm --filter @openlinguo/data-pipeline tts-bakeoff serve
```

- `tools/tts/voices/designed-zh-female.wav` is a synthetic voice made by `moss-voice-generator` from a text description (no real speaker); MOSS-TTS clones it.
- Isolated words are sent with a final 。, without which MOSS-TTS often does not stop; its server also caps the length at about 2 s per syllable, and every file keeps only its first utterance (audio after a pause longer than 0.7 s is dropped, silence trimmed to 0.1 s).
- `generate` synthesizes the 36 bake-off items of `src/tts/bakeoff-set.ts` into `tools/tts/.bakeoff/` (gitignored, resumable).
- `serve` opens a local listening page: each item with every engine's version in a fixed, named order and a pick for the best one, saved on every change; `report` counts the picks and writes `tools/tts/bakeoff-results.json`.
- Each image's `requirements.lock` is a `uv pip compile` of its upstream dependencies without demo-only packages (gradio) and without torch, whose ROCm wheel comes from `download.pytorch.org/whl/rocm6.4`; compiled in `python:3.10-slim` with `--python-version 3.10 --python-platform x86_64-manylinux_2_28 --exclude-newer <7 days ago>`.

## Mandarin audio packs

One pack per referential band: every word reading recorded by MOSS-TTS, checked by Qwen3-ASR (ADR 0007), encoded as MP3 marked AI-generated (ID3, AI Act art. 50(2)) and stored in zip parts of at most 20 MiB, released under CC0 1.0. Docker and `ffmpeg` (on `PATH`) are needed; the script starts and stops each container itself, since the 24 GB card holds one model at a time.

```bash
pnpm --filter @openlinguo/data-pipeline tts-packs build --band hsk-2025:1
pnpm --filter @openlinguo/data-pipeline tts-packs review
pnpm --filter @openlinguo/data-pipeline tts-packs pack --band hsk-2025:1
```

- `build` records each reading (seed 1), transcribes it and checks that the transcript has one character per syllable, each readable as the expected syllable (any reading CC-CEDICT gives the character, words included), tones aside. An isolated syllable is also doubted when the character heard has another tone and a tone model of this voice confidently hears another tone. A failing recording is redone with seeds 2 to 5. Transcripts are kept, so a changed check applies without the GPU. State lives in `tools/tts/.packs/` (gitignored, resumable).
- With `--band syllables`, `build` then fills the chart pairs still missing by tone transfer (ADR 0007): a recording of the same syllable in another tone keeps its consonant and vowel and takes the voice's mean contour and length for the missing tone, through the WORLD vocoder (`tools/tts/world`, CPU only; build it once with `docker compose -f tools/tts/compose.yaml build world`). A syllable heard in no tone first gets seeds: up to 3 characters read only as that syllable, each with seeds 1 to 5, recorded only to be a source. A transfer ships when its source, re-synthesized in its own tone, is still heard as its syllable by Qwen3-ASR, and when `contour()` finds the pitch it was given; no one listens. The vocoded files live in `tools/tts/.packs/transfer/`.
- `review` opens a local page with the recordings whose word fails with every seed: each can be validated by ear or rejected. Without a verdict, a recording that fails with every seed ships without audio.
- `pack` refuses a band with recordings not built or not checked. It writes the zip parts to `tools/tts/.packs/out/`, the index `data/audio-zh/packs.json` (pinned in `data/manifest.json`), and `data/gaps/audio-zh.tsv`: words with several readings (MOSS-TTS cannot be told which one to say), words without a reading, recordings rejected by ear or failing every seed; for the chart, pairs whose syllable is heard in no tone (`no-source`) or whose transfers all fail the checks (`unverified`).
- The parts are uploaded to the GitHub release named in `packs.json` (`gh release create` for a new release, `gh release upload --clobber` to replace a part); a test fails when the word lists change after the packs were built. A new release packs every band again, from the same recordings for the word bands.

## Speech recognition model

Paraformer-small, run in the app by sherpa-onnx compiled to WebAssembly (ADR 0007, #119). Docker is needed for the build; its versions are pinned in `tools/sherpa-onnx/Dockerfile`.

```bash
docker build --output type=local,dest=tools/sherpa-onnx/out tools/sherpa-onnx
pnpm --filter @openlinguo/data-pipeline paraformer
```

- The build writes the binary, its JavaScript, `build.json` (versions), the licenses of everything compiled in and their `SHA256SUMS` to `tools/sherpa-onnx/out/` (gitignored).
- `paraformer` downloads the pinned model files from Hugging Face, checks them and the build's files against their hashes, then writes `data/paraformer/` (pinned in `data/manifest.json`) and the JavaScript in `apps/web/src/lib/sherpa-onnx/`, and prints the command uploading the release assets. Bump `RELEASE` in `src/asr/paraformer.ts` for any change: the app refuses JavaScript that does not match the binary.
