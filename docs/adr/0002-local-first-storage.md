# 0002 — Local-first storage

- Status: Accepted
- Date: 2026-10-09

## Context

Learning must work offline and without an account. Multi-device sync and leagues come later and must not require a rewrite.

## Decision

- User data lives on the device in IndexedDB via Dexie, with `navigator.storage.persist()` and JSON export/import.
- Reviews are stored as an append-only log; card state is derived from it.
- Sync (M8) merges review logs (conflict-free by construction) and uses last-writer-wins per field for card content.
- XP and achievements are pure functions of the review log, so client and server compute the same values.

## Consequences

- Full offline use, no account needed to learn.
- Leagues cannot fully prevent cheating; the server recomputes XP from uploaded logs and applies plausibility caps.
