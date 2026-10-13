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

## Mandarin TTS bake-off

The engines run as Docker containers on the Radeon through WSL2 (`tools/tts/compose.yaml`, ports on localhost only), one at a time on a 24 GB card. Models are downloaded at their pinned revision on first start.

```bash
docker build -t openlinguo-rocm-wsl:6.4.2 tools/tts/rocm-wsl
docker compose -f tools/tts/compose.yaml up -d moss-tts
pnpm --filter @openlinguo/data-pipeline tts-bakeoff generate --engines moss-tts,moss-tts-pinyin
docker compose -f tools/tts/compose.yaml stop moss-tts
docker compose -f tools/tts/compose.yaml up -d glm-tts
pnpm --filter @openlinguo/data-pipeline tts-bakeoff generate --engines glm-tts
pnpm --filter @openlinguo/data-pipeline tts-bakeoff serve
pnpm --filter @openlinguo/data-pipeline tts-bakeoff report
```

- `tools/tts/voices/designed-zh-female.wav` is a synthetic voice made by `moss-voice-generator` from a text description (no real speaker); the cloning engines use it as their reference.
- `generate` synthesizes the 36 items of `src/tts/bakeoff-set.ts` into `tools/tts/.bakeoff/` (gitignored, resumable). `moss-tts-pinyin` sends MOSS-TTS tone-numbered pinyin with the spoken tones instead of characters.
- `serve` opens a local comparison page: each item with every engine's version in a fixed, named order; the maintainer listens to the items they choose and picks the best version (or none), saved on every change.
- `report` counts the picks per engine, overall and per category, and writes `tools/tts/bakeoff-results.json`.
- Each engine's `requirements.lock` is a `uv pip compile` of its upstream dependencies without demo-only packages (gradio) and without torch, whose ROCm wheel comes from `download.pytorch.org/whl/rocm6.4`; compiled in `python:3.10-slim` with `--python-version 3.10 --python-platform x86_64-manylinux_2_28 --exclude-newer <7 days ago>`.
