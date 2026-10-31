# @openlinguo/api

The server of [ADR 0015](../../docs/adr/0015-backend-and-shared-library.md): a Hono app under `/api`, served as Pages Functions on the PWA's origin (`apps/web/functions/api/[[route]].ts`), and a cron Worker for the daily jobs (`wrangler.jsonc`), both bound to one D1 database.

- `pnpm db:generate` writes a migration in `migrations/` after a change to `src/schema.ts`.
- `pnpm types` regenerates `worker-configuration.d.ts` after a change to `wrangler.jsonc`; `typecheck` fails while it is out of date.
- Tests run in Vitest against a local D1 in memory, migrated, through wrangler's `getPlatformProxy` (`src/testing/platform.ts`).
- Locally: `wrangler d1 migrations apply openlinguo --local --persist-to ../web/.wrangler/state`, then from `apps/web`, `wrangler pages dev --persist-to .wrangler/state`, which reads `apps/web/wrangler.jsonc`.
- Production: `.github/workflows/deploy.yml` ([ADR 0010](../../docs/adr/0010-branches-and-ci.md)).

## Settings of the Pages project

Checked at each request by `AuthEnv` (`src/auth.ts`): a missing or invalid one answers 500 and logs its name, never a default. Placeholders for `wrangler pages dev` are in `apps/web/.dev.vars.example`. The maintainer creates the values and enters each one as a secret (type Secret in the dashboard, or `wrangler pages secret put`), since `apps/web/wrangler.jsonc` owns the plain variables; they never go in the repo.

- [ ] `BETTER_AUTH_SECRET`: 32 random characters or more (`openssl rand -base64 32`), as an encrypted secret.
- [ ] `BETTER_AUTH_URL`: `https://openlinguo.razakk.fr`.
- [ ] Google: an OAuth client "Web application" in Google Cloud, redirect URI `https://openlinguo.razakk.fr/api/auth/callback/google`, scopes `openid email profile`; `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (secret).
- [ ] GitHub: an OAuth App, callback URL `https://openlinguo.razakk.fr/api/auth/callback/github`; `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (secret).
- [ ] Scaleway Transactional Email, region `fr-par`: a checked sending domain, then an IAM API key whose policy allows only sending Transactional Email in that project; `SCW_SECRET_KEY` (secret), `SCW_PROJECT_ID`, `MAIL_FROM` (an address on the checked domain).
- [ ] `SIGNUPS_OPEN`: leave unset (closed) until #279 and #280 are merged; `true` opens them, `false` closes them, anything else is refused.
