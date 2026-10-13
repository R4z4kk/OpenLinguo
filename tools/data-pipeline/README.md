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
