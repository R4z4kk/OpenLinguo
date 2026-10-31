# 0015 — Backend and shared library

- Status: Accepted
- Date: 2026-10-31 (#35)
- Supersedes the hosting part of [ADR 0005](0005-backend-and-hosting.md)

## Context

M7 (#35) adds the first server: optional accounts, a shared library of texts submitted by learners and moderated by the maintainer, account export and deletion, retention jobs, the legal pages and the deployment. Exit criteria: a text submitted on one device, approved by the admin, is visible on another device; export and deletion work end to end.

ADR 0005 chose Hono, Drizzle, Postgres and Better Auth (email/password, Google, GitHub, admin role), self-hosted with Docker behind Traefik. ADR 0014 kept the coverage code in `core` so the server could estimate a text's level. The SMTP provider was left to M7.

What exists on develop (3f33e56): no server code. The repository runs TypeScript natively (`nodenext`, `.ts` imports, `erasableSyntaxOnly`), uses Vitest 5, and the PWA is not deployed yet.

## Findings (2026-10-31)

Every source was read on its official site that day. The full notes, with a URL and a short quote for each point, were kept outside the repo. This is not legal advice.

### Hosting and legal notices

- A non-professional publisher may stay anonymous by publishing only "le nom, la dénomination ou la raison sociale et l'adresse du fournisseur de services d'hébergement", provided the host has their identity ([LCEN art. 1-1 II](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000049568614)). Self-hosting makes the maintainer the host, so their name, address and phone would be public. The maintainer declined that, which ruled out the homelab.
- Free hosts compared on their own pages: Cloudflare Workers/Pages with D1, Oracle Always Free, Scaleway serverless, Alwaysdata, Neon, Supabase, Koyeb, Clever Cloud, Render, Fly.io, Railway. Only Cloudflare is free with a managed database, backups and a custom domain. Oracle reclaims idle VMs; Alwaysdata's free plan has no custom domain; Supabase pauses after 7 days; Render's free Postgres expires after 30 days; Scaleway's database is not free.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (updated 2026-10-29): 10 ms of CPU per request on the free plan, 128 MB per isolate, 1 s startup, 64 MiB script.
- Workers "does not support any domain whose nameservers are not managed by Cloudflare"; Pages does ([migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/), updated 2026-10-12). The DNS stays at OVH, so the API runs as Pages Functions.
- D1 databases created with `--jurisdiction=eu` "only run and store data within a region"; the jurisdiction cannot be changed later ([data location](https://developers.cloudflare.com/d1/configuration/data-location/), updated 2026-10-02).

### Spikes (throwaway, outside the repo)

- Better Auth 1.7.12 + Drizzle 0.45.4 + Hono 4.13 run in `workerd` (wrangler 4.152) and natively in Node 24. Checked: email verification blocks sign-in until done, cookies are `HttpOnly; SameSite=Lax`, the admin plugin sets a role, `delete-user` cascades, the magic-link token is single use, a cron handler runs.
- Better Auth's scrypt costs about 70 ms of CPU per hash or verify; WebCrypto PBKDF2 costs 16 ms at 100,000 iterations. Neither fits 10 ms, so password sign-in is not possible on the free plan.
- Accounts created by a magic link or by OAuth carry no extra field, so an age declaration cannot be taken at sign-up for those methods.
- `@cloudflare/vitest-pool-workers` 0.23 requires Vitest 4. `getPlatformProxy` from wrangler gives a real local D1 to Vitest 5 in Node: a sign-in test ran green in 2.3 s.
- Hono through `hono/cloudflare-pages` serves `/api/*` from a Pages project next to the static files, with the D1 binding. The bundle is 2.1 MiB (382 KiB gzipped).

### Email

- Scaleway Transactional Email: French company, data "stored and processed in France", no dedicated sub-processor, no open or click tracking, 300 emails a month free, DPA part of the contract, terms open to natural persons, REST API callable with `fetch` (version `v1alpha1`) and SMTP ([data privacy](https://www.scaleway.com/en/docs/transactional-email/reference-content/data-privacy/), [pricing](https://www.scaleway.com/en/pricing/managed-services/)).
- Rejected: Brevo and Mailjet (terms exclude non-professional use), Amazon SES, Postmark and Resend (data in the U.S.), Lettermint (licence limited to "own business operations"), an OVH mailbox (not meant for automated mail), self-hosted Postfix (residential IP on the Spamhaus PBL).
- Tracking pixels in emails need consent ([CNIL délibération 2026-042](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053876850), 12 March 2026). Emails without a pixel need nothing.

### Platform law

- The library is a hosting service and an online platform under the [DSA](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065) (art. 3(g)(iii), 3(i)). Whether a service with no remuneration is in scope at all is doubtful; at most the micro regime applies. Applicable: arts 11 and 12 (points of contact), 14 (terms), 16 (notice and action), 17 (statement of reasons, for every restriction including a rejection at moderation), 18, and 24(3) on request. Exempt: arts 15, 20 to 28 (including the Transparency Database) and 29. The Commission's art. 28 guidelines (C/2025/5519, para 8) leave micro platforms out.
- [LCEN art. 6](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000801164) now defines hosts by the DSA. Its V and [décret 2021-1362](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000044228912) require a host to keep, "dans la mesure où elles sont collectées", the civil identity of a contributor for five years after the contract ends (art. 2), the login identifier, pseudonyms and password data for one year (art. 3), and the connection identifier of each creation, modification or deletion of content for one year (arts 5 and 7). Hosts must also report the serious offences of art. 6 IV.A, remove content within 24 hours on an administrative order (art. 6-1), and terrorist content within one hour ([Regulation 2021/784](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32021R0784)).
- Approving a text before publication engages the publication director's liability under loi 82-652 art. 93-3; the moderation checklist covers defamation and hate speech.
- [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en) is irrevocable (§2(a)(1), §6(c)); the licensor may ask for their name to be removed (§3(a)(3)). Purely AI-generated text is most likely not protected by copyright (CJEU [C-5/08 Infopaq](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62008CJ0005), [C-145/10 Painer](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62010CJ0145); European Parliament resolution of 10 March 2026, point 25), so a CC BY-SA licence on it would be empty.
- AI Act art. 50(4) does not apply to stories in the library: the [art. 50 guidelines](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems) (para 131) place "AI-generated fantasy novels" outside it. Directive 2019/790 art. 17 and CPI L137-1 do not apply (no profit purpose, small volume).

### Privacy

- With contract as the legal basis, GDPR art. 8 and Loi Informatique et Libertés art. 45 do not apply; what counts is a minor's capacity to contract. CNIL [recommendation 1](https://www.cnil.fr/fr/recommandation-1-encadrer-la-capacite-dagir-des-mineurs-en-ligne) accepts this from 15 if parents can ask for their child's account to be deleted; [recommendation 7](https://www.cnil.fr/fr/recommandation-7-verifier-lage-de-lenfant-et-laccord-des-parents-dans-le-respect-de-sa-vie-privee) accepts a self-declaration for low-risk services.
- No French "digital majority" is in force: loi 2023-566 enters into force "à une date fixée par décret" ([art. 7](https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000047799540)), never published, and art. 1 of loi 2026-813 was struck down ([décision 2026-911 DC](https://www.legifrance.gouv.fr/cons/id/CONSTEXT000054952977)). The roadmap said otherwise.
- Délibération 2021-122 excludes perimeter logging; the CNIL fiche [« Tracer les opérations »](https://www.cnil.fr/fr/securite-tracer-les-operations) covers it, 6 months to 1 year. The 2-year inactivity reference is [délibération 2021-131](https://www.legifrance.gouv.fr/cnil/id/CNILTEXT000045543374/), not binding.
- [Délibération 2022-100](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000046432885) on passwords does not apply once there are none. The CNIL [multi-factor recommendation](https://www.cnil.fr/sites/cnil/files/2025-03/recommandation_relative_a_l_authentification_multifacteur.pdf) (2025-019) asks for strong authentication on privileged accounts.
- DPIA: no type on the CNIL lists ([2018-327](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000037559521), [2019-118](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000039248939)) matches. M7 meets one WP248 criterion (minors); M8 leagues add ranking, so a DPIA is required before leagues open.
- On the [official DPF list](https://www.dataprivacyframework.gov/list): Cloudflare, Inc. active (due 2027-09-15), Google LLC (2027-09-13), GitHub's own entry (2027-08-03). The [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) "forms part of the Main Agreement", the self-serve agreement included. Google and GitHub act as independent controllers for their sign-in. The General Court dismissed Latombe (T-553/23) on 2025-09-03; the appeal C-703/25 P is pending.
- The EDPB [erasure report](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf) (February 2026) asks for erasures to be re-applied after a backup is restored.

## Decision

All choices below are the maintainer's, 2026-10-31.

- **Hosting**: Cloudflare, free plan. The API runs as Pages Functions on the PWA's own origin, `https://openlinguo.razakk.fr/api/*`, so there is no CORS and no third-party cookie, and the CSP `connect-src` needs only `'self'` for it. One D1 database, created with jurisdiction `eu`. A separate Worker, bound to the same database, runs the daily jobs from a cron trigger. The legal notice names Cloudflare, Inc. as host and the maintainer stays anonymous (LCEN art. 1-1 II). If the free limits stop fitting, Workers Paid ($5 a month) is the way out with no redesign. This replaces the homelab, Traefik, Docker and Postgres of ADR 0005.
- **Packages**: `apps/api` holds the Hono app (`basePath("/api")`), Better Auth, the Drizzle schema (`sqlite-core`) and migrations, the jobs, and the cron Worker's entry. `apps/web/functions/api/[[route]].ts` mounts it with `hono/cloudflare-pages`. API contracts (`LibraryItem`, `Submission`, `Notice`, `StatementOfReasons`, `ApiError` with typed codes) are zod schemas in `packages/core`: the API validates every request with them, the web every response. The admin UI is a lazy route of `apps/web`. Added dependencies: `hono`, `better-auth`, `drizzle-orm`; `wrangler` and `drizzle-kit` in development. No database driver, mail library or scheduler library.
- **Sign-in**: no passwords. A 6-digit code by email (Better Auth `emailOTP`, valid 10 minutes, 3 attempts), Google, or GitHub. A code typed in the app works in the installed PWA on iOS, where a link would open Safari and leave the app signed out. Better Auth's rate limits are on, and every sign-in, failure, code sent and admin action goes to `security_event`.
- **Age**: a step right after the first sign-in, for every method: « J'ai 15 ans ou plus » or « J'ai moins de 15 ans », neutral, in plain words. Until it is answered, every API route except this step and account deletion answers 403 `AGE_DECLARATION_REQUIRED`. « Moins de 15 ans » deletes the account at once. An account with no answer after 24 hours is purged.
- **Admin**: the Better Auth admin role, with a TOTP code mandatory (`twoFactor`, with backup codes). Admin routes refuse a session whose second factor is not verified. Other accounts may turn TOTP on.
- **Email**: Scaleway Transactional Email through one `sendMail(to, template)` function that calls its REST API with `fetch`; no tracking, nothing else. A failed send returns a typed error to the caller, never a silent success. SMTP is the fallback if the API version changes.
- **Submissions**: from a local text, « Soumettre à la bibliothèque » shows the licence, fixed by the origin, the attribution (the pseudonym, or anonymous), a versioned attestation and a preview. A text the learner wrote: CC BY-SA 4.0, attesting that they wrote it, own the rights and know the licence cannot be revoked. A story generated in the app: CC0 1.0, attesting that it was generated in OpenLinguo and contains no third-party text, with its badge and provenance kept. Plain text only, at most 20,000 characters, at most 5 pending per account.
- **Moderation**: every text is approved before it is published. In `/admin`, the level is estimated in the admin's browser with `core` and `lang-zh`, which already hold the dictionary, and stored with the approval; the server does not segment text, which its CPU and memory limits would not allow. A checklist covers copyright, defamation, hate, other people's personal data and the art. 6 IV.A offences. Every rejection or removal records a statement of reasons with the fields of DSA art. 17(3) (measure, facts, own initiative or notice, legal ground or terms clause, no automated means) and emails it to the submitter.
- **Public library**: `GET /api/library` (approved texts, paginated, filtered by band) and `GET /api/library/:id`, public, each item with its origin and AI badge, provenance, licence, attribution, link to the licence and any change made. The Read tab gets « Bibliothèque globale »; « Importer » copies a text into the local texts with its licence, attribution and provenance.
- **Notice and action**: « Signaler » on every library text opens a form that needs no account: the text, the reasons, name and email (optional for child sexual abuse material), and the good-faith statement of DSA art. 16(2)(d), with the reminder that a false notice is an offence (LCEN art. 6 VII). The notifier gets a receipt, then the decision; the submitter gets the statement of reasons. A removed text is `removed`; copies already imported stay on devices, as the terms say. A review is requested by email.
- **Account**: profile with an editable pseudonym; export as JSON (account, sessions, submissions, decisions). Deletion cascades. For published texts the learner chooses: keep with my name, keep as anonymous (the default) or remove from the library. Pending and rejected texts are always deleted.
- **Retention**: kept "dans la mesure où elles sont collectées" (décret 2021-1362), legal basis GDPR art. 6(1)(c), in `hosting_record`, which only the jobs and the admin export for an authority can read. For each creation, edit or deletion of a submission: the IP address, the source port when Cloudflare passes it, and the time, for 1 year. When an account that submitted is deleted: its email for 5 years and its pseudonym for 1 year. Nothing else.
- **Daily jobs** (cron Worker), each recorded in `job_run`:

| Data | Deleted |
|---|---|
| Security events | after 6 months |
| Sessions, codes, verification tokens | at expiry |
| Accounts with no age answer | after 24 hours |
| Inactive accounts | after 2 years without action, with an email 30 days before |
| Connection records and sealed pseudonyms (décret) | after 1 year |
| Sealed emails (décret) | after 5 years |
| Notices and statements of reasons | 1 year after the decision |
| Erasure log, re-applied after a Time Travel restore | after 8 days |

  `GET /api/health` answers 503 when a job failed or has not succeeded for 26 hours. The maintainer's Uptime Kuma polls it. Rights requests by email are kept until answered, then 5 years as proof (Code civil art. 2224).
- **Sign-ups closed** until the legal pages, the updated compliance documents, the DPIA and the processor checks are merged and the maintainer opens them: `SIGNUPS_OPEN=false` by default.
- **Legal pages** (FR and EN, plain language for teenagers): `/legal` (anonymous non-professional publisher, Cloudflare as host, one contact address for authorities and users, in French and English), `/privacy` (the existing notice completed: processing, retention, the décret, the right to object to security logs, a channel for parents to ask for their child's account to be deleted), `/terms` (DSA art. 14: content rules, human moderation, statements of reasons, review by email, imported copies).
- **Compliance documents**: records of processing (Cloudflare D1, Scaleway as processor, new P2b notice and action, new P8 hosting retention), data map, retention schedule (backups: D1 Time Travel, 7 days), sub-processors (DPF status from the official list, Google and GitHub as independent controllers), `ai.md` (stories published, art. 50(4) set aside under para 131, CC0), a moderation runbook (checklist, PHAROS reports, 24-hour and 1-hour removal orders). The DPF and DPA statuses are dated values with `checkedOn` and `reviewBy`; a CI test fails on the review date.
- **DPIA**: written in M7 with the CNIL PIA method, covering accounts and the M8 leagues.
- **Deployment**: `deploy.yml` runs on a promotion merged into `main` or by hand, in the GitHub environment `production` with the maintainer's approval: D1 migrations (`wrangler d1 migrations apply --remote`), then `wrangler pages deploy`, then the cron Worker. The Cloudflare token is scoped to Pages and D1. No preview deployments, which would share the production database. `openlinguo.razakk.fr` is a CNAME at OVH to the Pages project; `*.pages.dev` is never given to users. Backups: D1 Time Travel, 7 days, no copy elsewhere.
- **Mockups first** (ADR 0008): sign-in (code, Google, GitHub, age step, TOTP), submit dialog, global library, admin queue and statement of reasons, report form, legal pages.
- **Verification**: unit tests for the contracts and the purge rules; API tests in Vitest 5 against a real local D1 through `getPlatformProxy`, with mail captured in memory; E2E on Chromium and WebKit with axe against `wrangler pages dev` serving the built PWA and the Functions. The exit test uses two browser contexts: submit, approve with a TOTP code computed in the test, read on the other; then export and delete.

## Consequences

- Nothing to operate: no server, no TLS, no backups to run. The price is SQLite instead of Postgres, no passwords and 10 ms of CPU per request. M8 sync and leagues must fit the same limits or move to Workers Paid.
- Cloudflare becomes the host of personal data, not only the CDN: it moves from "serves the PWA" to processor of accounts and submissions, under its DPA and the DPF, in the EU jurisdiction for the database.
- Learners without Google or GitHub need email access to sign in each time a session ends.
- The level of a library text is the admin's estimate, computed with the same code as the reader, not a server computation.
- The maintainer is the publication director of every approved text, and answers notices and orders within the legal delays.
- Some data outlives account deletion (décret 2021-1362), which the privacy notice and the deletion screen say.
- ADR 0005 keeps its stack choices (Hono, Drizzle, Better Auth); its hosting and Postgres parts are replaced here. ADR 0009's minors and logging references are corrected in the roadmap.
