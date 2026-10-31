# @openlinguo/api

The server of [ADR 0015](../../docs/adr/0015-backend-and-shared-library.md): a Hono app under `/api`, served as Pages Functions on the PWA's origin (`apps/web/functions/api/[[route]].ts`), and a cron Worker for the daily jobs (`wrangler.jsonc`), both bound to one D1 database.

- `pnpm db:generate` writes a migration in `migrations/` after a change to `src/schema.ts`.
- `pnpm types` regenerates `worker-configuration.d.ts` after a change to `wrangler.jsonc`; `typecheck` fails while it is out of date.
- Tests run in Vitest against a local D1 in memory, migrated, through wrangler's `getPlatformProxy` (`src/testing/platform.ts`).
- Locally: `wrangler d1 migrations apply openlinguo --local --persist-to ../web/.wrangler/state`, then from `apps/web`, `wrangler pages dev --persist-to .wrangler/state`, which reads `apps/web/wrangler.jsonc`.
- Production: `.github/workflows/deploy.yml` ([ADR 0010](../../docs/adr/0010-branches-and-ci.md)).

## Admin

The app never grants the admin role: no route sets it. The maintainer signs in once, answers the age step, then runs from `apps/api`, with their address in both places:

```bash
wrangler d1 execute openlinguo --remote --command "UPDATE user SET role = 'admin' WHERE email = 'me@example.org'; INSERT INTO security_event (type, method, target, created_at) SELECT 'admin_action', 'grant-admin', id, unixepoch() * 1000 FROM user WHERE email = 'me@example.org'"
```

Wrangler must report 2 rows written; 0 means the address has no account. `SET role = NULL` and `'revoke-admin'` take the role back. Admin routes (`/api/auth/admin/*`, `/api/admin/*`) then answer 403 `TWO_FACTOR_REQUIRED` until an authenticator is set up (`/api/auth/two-factor/enable`, then `verify-totp`); keep the backup codes offline. Every session of an account with TOTP on must pass `verify-totp` or `verify-backup-code` first, and 10 wrong codes in 15 minutes lock it for 15 minutes. Admin actions go to `security_event` with their operation in `method` and the user concerned in `target`.

## Restoring a backup

D1 Time Travel restores the whole database, `erasure` included: an account deleted after the restore point would come back with its texts. The `erasure` table keeps 8 days of deletions with the learner's choice; the daily job `reapply-erasures` deletes again every account it lists. So save it before restoring and put it back after, from `apps/api`:

```bash
wrangler d1 export openlinguo --remote --table erasure --no-schema --output erasure.sql
```

```bash
wrangler d1 time-travel restore openlinguo --timestamp=2026-11-01T08:00:00Z
```

```bash
sed -i 's/^INSERT INTO/INSERT OR IGNORE INTO/' erasure.sql && wrangler d1 execute openlinguo --remote --file erasure.sql
```

The next daily run deletes those accounts again, with the same choice for their published texts and their sealed identity. `erasure.sql` holds IP addresses: delete it once the run has succeeded (`/api/health` answers 200).

## Settings of the Pages project

Checked at each request by `AuthEnv` (`src/auth.ts`): a missing or invalid one answers 500 and logs its name, never a default. Placeholders for `wrangler pages dev` are in `apps/web/.dev.vars.example`. The maintainer creates the values and enters each one as a secret (type Secret in the dashboard, or `wrangler pages secret put`), since `apps/web/wrangler.jsonc` owns the plain variables; they never go in the repo.

- [ ] `BETTER_AUTH_SECRET`: 32 random characters or more (`openssl rand -base64 32`), as an encrypted secret. It also encrypts the TOTP secrets and backup codes: changing it makes them unreadable, and every authenticator must be set up again.
- [ ] `BETTER_AUTH_URL`: `https://openlinguo.razakk.fr`.
- [ ] Google: an OAuth client "Web application" in Google Cloud, redirect URI `https://openlinguo.razakk.fr/api/auth/callback/google`, scopes `openid email profile`; `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (secret).
- [ ] GitHub: an OAuth App, callback URL `https://openlinguo.razakk.fr/api/auth/callback/github`; `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (secret).
- [ ] Scaleway Transactional Email, region `fr-par`: a checked sending domain, then an IAM API key whose policy allows only sending Transactional Email in that project; `SCW_SECRET_KEY` (secret), `SCW_PROJECT_ID`, `MAIL_FROM` (an address on the checked domain).
- [ ] `CONTACT_EMAIL`: the address submitters write to for a review of a moderation decision, given in each statement of reasons; the one `/legal` gives (#279).
- [ ] `SIGNUPS_OPEN`: leave unset (closed) until #279 and #280 are merged; `true` opens them, `false` closes them, anything else is refused.
