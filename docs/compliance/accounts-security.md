# Accounts that reach production

The D1 console in the Cloudflare dashboard reads every table without the admin's authenticator, and whoever controls the GitHub `production` environment can deploy code that reads them. This checklist protects those paths ([DPIA](dpia.md), risk R1). It holds no secret: recovery codes and device details stay in the maintainer's private notes. The first pass is ticked on the #281 checklist. Sources read on 2026-11-02: Cloudflare, [API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [two-factor authentication](https://developers.cloudflare.com/fundamentals/account/account-security/2fa/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/general/), [audit logs](https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/); GitHub, [environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Cloudflare

- The maintainer is the only member of the account.
- Two-factor authentication with a security key or a TOTP app, not the emailed code: a mailbox should not be enough to open the database.
- Backup codes kept offline.
- API Tokens, under both My Profile and Manage Account: the deploy token and nothing else.
- The deploy token: Pages, D1 and Workers Scripts, on this account only, with a TTL end date of at most one year. No client IP filter: GitHub's runners have no fixed address.

## Wrangler on the maintainer's computer

`wrangler login` asks for every scope by default and stores its token in a plain text file, so that file reaches production without the admin's authenticator.

- Sign in with `wrangler login --use-keyring`, so the token goes to the system's keychain.
- `wrangler logout` at the end of each session on production. It also invalidates the token.

## GitHub

- Two-factor authentication on, recovery codes kept offline.
- The maintainer is the only collaborator.
- Environment `production`: the maintainer is the only reviewer, `main` is the only branch, administrators cannot bypass it.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are secrets of that environment, none at repository level. `deploy.yml` passes them to the `wrangler` steps only, never to install or build, which run third-party code.

## Deploy token expiry

The end date is `DEPLOY_TOKEN` in `packages/core/src/compliance-facts.ts`; it is not a secret. From a month before it, a unit test fails in the nightly CI. To renew:

1. Create a token with the same permissions and an end date at most a year away.
2. `gh secret set CLOUDFLARE_API_TOKEN --env production`
3. Run `deploy` and approve it, then delete the old token.
4. Move `value`, `checkedOn` and `reviewBy` in `DEPLOY_TOKEN`.

## Direct reads of the database

Only for an incident, a rights request, a requisition, a removal order or [the admin's account](../../apps/api/README.md#admin). A request keeps its proof in the mailbox ([requests runbook](requests.md), section 5).

## Audit log

Once a month and after any alert: `audit-log-check.yml` opens an issue on the 1st, and closing it is the record. The repository is public, so nothing about the findings goes in the issue.

On the Audit Logs page, last month: a sign-in you do not recognise, a member or a token created or changed, a setting changed, a call by a token that is not the deploy token, a deploy-token call outside a `deploy` run, a D1 `database.raw`, `database.query` or `database.export` that no incident, request or `deploy` run explains. The page hides `view` actions and shows 90 days; the API has the rest for 18 months. Anything unexplained opens the [breach procedure](breach-procedure.md).

## Other accounts of the service

The same two-factor authentication on OVH (the DNS can send the domain and its mail elsewhere), Lettermint, Google Cloud and the mailbox `openlinguo@gmail.com`.
