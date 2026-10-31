# @openlinguo/api

The server of [ADR 0015](../../docs/adr/0015-backend-and-shared-library.md): a Hono app under `/api`, served as Pages Functions on the PWA's origin (`apps/web/functions/api/[[route]].ts`), and a cron Worker for the daily jobs (`wrangler.jsonc`), both bound to one D1 database.

- `pnpm db:generate` writes a migration in `migrations/` after a change to `src/schema.ts`.
- `pnpm types` regenerates `worker-configuration.d.ts` after a change to `wrangler.jsonc`; `typecheck` fails while it is out of date.
- Tests run in Vitest against a local D1 in memory, migrated, through wrangler's `getPlatformProxy` (`src/testing/platform.ts`).
- Locally: `wrangler d1 migrations apply openlinguo --local --persist-to ../web/.wrangler/state`, then from `apps/web`, `wrangler pages dev dist --d1 DB=00000000-0000-0000-0000-000000000000 --persist-to .wrangler/state`.
