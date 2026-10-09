# 0001 — Platform and frontend stack

- Status: Accepted
- Date: 2026-10-09

## Context

The app needs iOS, Android and web reach, microphone and camera access, and heavy use of browser-native libraries (Hanzi Writer, Web Audio, transformers.js Whisper). All project code must be TypeScript.

## Decision

- Web PWA first: React + Vite + TypeScript, `vite-plugin-pwa`, TanStack Router, Tailwind, i18next.
- Native shells via Capacitor after v1, reusing the same web code.
- Flutter and React Native are rejected: Flutter is not TypeScript; React Native would require ports or WebViews for the DOM-based libraries.
- pnpm workspaces monorepo: `apps/web`, `apps/api`, `packages/core`, `packages/lang-zh`, `packages/lang-en`, `tools/data-pipeline`.

## Consequences

- One codebase, every browser API available as-is.
- iOS PWA limits (storage eviction, background audio) are mitigated by `navigator.storage.persist()`, backups, and later Capacitor.
