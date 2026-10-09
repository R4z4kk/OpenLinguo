# 0005 — Backend and hosting

- Status: Accepted
- Date: 2026-10-09

## Context

A server is needed for the shared library (user submissions, admin moderation), and later for sync and leagues. The project must stay self-hostable and TypeScript-only.

## Decision

- API: Hono + Drizzle + Postgres + Better Auth (email/password with verification, Google, GitHub OAuth, admin role). zod validation, rate limits, secure headers.
- `packages/core` and the language packs also run in the API (server-side level estimation of submitted texts).
- PWA on Cloudflare Pages with custom domain `openlinguo.razakk.fr`; API self-hosted with Docker behind Traefik at `openlinguo-api.razakk.fr`.
- PWA and API share a registrable domain so auth cookies are first-party (`SameSite=Lax`); CORS is restricted to the PWA origin.

## Consequences

- The app stays usable offline if the API is down (local-first).
- The maintainer operates the API host: backups, monitoring and security updates are part of the project's operations.
- SMTP provider choice is deferred to M7.
