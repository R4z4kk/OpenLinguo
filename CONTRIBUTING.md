# Contributing to OpenLinguo

OpenLinguo is maintained by one person, so reviews can take a while. Thank you for your time.

## Before you start

- Open an issue before a new feature or a large change, so you do not build something that does not fit. A small fix can go straight to a pull request.
- The project teaches Mandarin Chinese and plans no other language ([roadmap](docs/ROADMAP.md)).
- Read the [architecture decisions](docs/adr/) that touch your change. They say what was decided and why.
- Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says. Do not open a public issue for it.
- Report an accessibility problem in an issue, with the screen, the browser and what you expected.

## Set up

Node 24 and pnpm:

```bash
pnpm install
pnpm --filter @openlinguo/web dev
```

More in the [web app](apps/web/README.md) and [API](apps/api/README.md) READMEs.

## Branches and pull requests

1. Fork the repository and branch from `develop`, the default branch.
2. Open the pull request against `develop`. `main` only changes through a promotion pull request per milestone ([ADR 0010](docs/adr/0010-branches-and-ci.md)).
3. Fill in the pull request template, including its privacy and accessibility checklist.
4. The maintainer squash-merges. Name the pull request in the style of the recent ones (`feat(web): …`, `fix(api): …`, `docs: …`, `test(web): …`).

CI runs `quick` on every pull request: typecheck, lint, format, unit tests with coverage, build and data checks. The full browser tests (Chromium and WebKit) run nightly, on promotions and on demand. If your change touches the web app, ask the maintainer to run them on your branch. The maintainer approves each CI run on a pull request from a fork, on every push.

Before you push:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

For a change to the web app, also build it and run the browser tests that cover it: `pnpm --filter @openlinguo/web build`, then `pnpm e2e`.

## Code

- TypeScript only, strict. No `any`, and no `undefined`: lint refuses both (use `null`).
- Code, comments, branch names and commit messages are in English. Comments say why, and only when it is not obvious.
- Text shown to users goes in `apps/web/src/i18n/en.ts` and `fr.ts`. A missing key fails typecheck.
- A failure is shown to the user. No silent fallback and no default value in place of an error.
- A value that can go stale (a rate, a limit, a legal text, a price) is dated with its source in `packages/core/src/compliance-facts.ts`, and a test fails when it expires.
- A new UI follows [the design system](docs/design/DESIGN-SYSTEM.md). The end-to-end tests check accessibility on every route; add yours to `apps/web/e2e/routes.ts` for a new route.

## Data and licenses

- Code is [AGPL-3.0](LICENSE). By contributing, you license your contribution under it. There is no contributor agreement to sign.
- Do not add or change a dataset without its source, license and checks in [`data/SOURCES.md`](data/SOURCES.md). Datasets keep their own licenses.
- Texts for the shared reading library are not pull requests: they are submitted in the app, with a license attestation, and moderated ([moderation](docs/compliance/moderation.md)).
