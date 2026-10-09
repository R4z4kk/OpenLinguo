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
- HSK levels use the 2025 exam syllabus as a versioned dataset (`hsk-2025`), extracted by the pipeline from the official CTI PDF and validated against the syllabus's published totals; third-party transcriptions are only used to cross-check.
- Excluded: commercial graded readers, non-commercial (NC) licensed content, Tatoeba audio (mixed licenses).

## Consequences

- Share-alike data (CC BY-SA) stays compatible with the AGPL code.
- Data updates are visible, reviewed and attributable.
