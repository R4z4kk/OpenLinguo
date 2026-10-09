# 0004 — Data sources and licensing

- Status: Accepted
- Date: 2026-10-09

## Context

The app depends on third-party linguistic datasets with mixed licenses, some of which change over time (dictionary releases, HSK syllabus editions).

## Decision

- Code is AGPL-3.0. Each dataset keeps its own license, listed with attribution in `data/SOURCES.md` and the app's about page.
- Datasets are built by `tools/data-pipeline` from pinned URLs verified by sha256, never committed raw.
- `data/manifest.json` records per dataset: source, license, version, `retrievedAt`, `maxAgeDays`, sha256.
- CI fails when a manifest entry is past `maxAgeDays`. A monthly workflow pushes a refresh branch and opens an issue with diff stats; the maintainer opens the PR (PRs created with the workflow token would not trigger CI), and refresh PRs are never auto-merged.
- HSK levels use the 2025 exam syllabus as a versioned dataset (`hsk-2025`). The official CTI PDF is copy-protected, so the levels come from a pinned third-party transcription (harukicoder/hsk30), verified on the published character counts and the distinct word count, while permission to use the official PDF is requested (decision 2026-10-09). The GF0025-2021 national standard (unrestricted official PDF, OCR verified on exact counts) ships as a second, free referential and as the fallback if the 2025 levels must be removed.
- Excluded: commercial graded readers, non-commercial (NC) licensed content, Tatoeba audio (mixed licenses).

## Consequences

- Share-alike data (CC BY-SA) stays compatible with the AGPL code.
- Data updates are visible, reviewed and attributable.
