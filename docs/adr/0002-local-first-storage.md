# 0002 — Local-first storage

- Status: Accepted
- Date: 2026-10-09; sync designed and leagues dropped 2026-11-03 ([ADR 0016](0016-sync.md))

## Context

Learning must work offline and without an account. Multi-device sync comes later and must not require a rewrite.

## Decision

- User data lives on the device in IndexedDB via Dexie, with `navigator.storage.persist()` and JSON export/import.
- Reviews are stored as an append-only log; card state is derived from it.
- Sync (M8) merges review logs (conflict-free by construction) and uses last-writer-wins per entity for the rest (ADR 0016).
- XP and achievements are pure functions of the review log.

## Consequences

- Full offline use, no account needed to learn.
