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

The engines run as Docker containers on CPU (`tools/tts/compose.yaml`, ports on localhost only). Models are downloaded at their pinned revision on first start.

```bash
docker compose -f tools/tts/compose.yaml up -d
pnpm --filter @openlinguo/data-pipeline tts-bakeoff generate
pnpm --filter @openlinguo/data-pipeline tts-bakeoff serve
pnpm --filter @openlinguo/data-pipeline tts-bakeoff report
```

- `generate` synthesizes the 36 items of `src/tts/bakeoff-set.ts` with every engine into `tools/tts/.bakeoff/` (gitignored, resumable).
- `serve` opens a local grading page: engines hidden, their order shuffled per item, grades saved on every change.
- `report` refuses to run until every sample is graded, then prints the tables and writes `tools/tts/bakeoff-results.json`.
- `tools/tts/melotts/requirements.lock` replaces MeloTTS's unpinned requirements (pip backtracks for hours on them). It is upstream `requirements.txt` without `gradio` (demo UI only), with `torch==2.3.1+cpu`, `torchaudio==2.3.1+cpu` and `setuptools<70`, compiled in `python:3.10-slim` by `uv pip compile --python-version 3.10 --python-platform x86_64-manylinux_2_28 --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match --exclude-newer <7 days ago>`.
