# Retention schedule

Periods decided in [ADR 0015](../adr/0015-backend-and-shared-library.md), enforced by the daily jobs of the cron Worker (#278). Each run is recorded in `job_run`; `GET /api/health` answers 503 when a job failed or has not succeeded for 26 hours. A failed purge is never skipped silently. Legal references were read on their official text on 2026-10-31.

## On the server

| Data | Retention | Basis |
|---|---|---|
| Account data | Until deletion by the user; after 2 years without any user action, notice by email, then deletion 30 days later. A failed notice stops that deletion and fails the job | CNIL délibération [2021-131](https://www.legifrance.gouv.fr/cnil/id/CNILTEXT000045543374/): 2 years "apparait proportionné", not binding |
| Accounts with no answer to the age step | 24 hours after creation | Purpose ends |
| Sessions | Until sign-out or expiry: 7 days, extended by a day of use (Better Auth defaults, #270) | Strictly necessary |
| Authenticator (TOTP secret, backup codes) | Until turned off or the account is deleted; a backup code is deleted once used | Purpose ends |
| Sign-in codes and verification tokens | Valid 10 minutes; deleted when used or refused, otherwise at expiry | Strictly necessary |
| Rate-limit counters (IP address and route) | Needed for 10 minutes at most; Better Auth never deletes them, so the daily jobs purge older rows | Security |
| Pending or rejected library submissions | Deleted with the account; a pending text can be withdrawn at any time | Purpose ends |
| Published library texts | Kept while published, under their licence (CC BY-SA 4.0, or CC0 1.0 for a story); at account deletion the person chooses: keep with their name, keep as anonymous (default) or remove | Licence terms |
| Statements of reasons (rejections and removals) | 1 year after the decision; deleted earlier with the text or the account | DSA art. 17; ADR 0015 |
| Notices (reports) and the decisions on them | 1 year after the decision | DSA art. 16; ADR 0015 |
| Hosting records of each creation, edit or deletion of a submission (IP address, time) | 1 year after the operation, also after the text or the account is deleted | [Décret 2021-1362](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000044228912) art. 5: "un an à compter du jour de la connexion ou de la création d'un contenu" |
| Sealed pseudonym of a deleted account that submitted | 1 year after the deletion | Décret 2021-1362 art. 3: "un an à compter de la fin de validité du contrat" |
| Sealed email of a deleted account that submitted | 5 years after the deletion | Décret 2021-1362 art. 2: "cinq ans à compter de la fin de validité du contrat" |
| Text removed on a removal order for terrorist content, with the related data | 6 months after the removal, longer only at the request of the authority or a court | [Regulation 2021/784](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32021R0784) art. 6(2); kept by hand, see the [moderation runbook](moderation.md) |
| Security events | 6 months | CNIL [« Tracer les opérations »](https://www.cnil.fr/fr/securite-tracer-les-operations): "entre six mois et un an" |
| Erasure log (ids of what was erased, time) | 8 days, so that erasures are applied again after a Time Travel restore | EDPB CEF 2025 report on the right to erasure; longer than the 7 days of Time Travel |
| Job runs (`job_run`: job, start, end, outcome; no personal data) | Not personal data | — |
| Database backups (D1 Time Travel) | 7 days on the Workers Free plan; deleted data disappears from them within 7 days | [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), `PROCESSOR_FACTS.d1TimeTravelDays` |
| Synced cards and review log (M8) | Until account deletion or user deletion of synced data | Purpose ends |
| League results (M8) | 12 weeks; deleted when leaving leagues | Purpose ends |

## Elsewhere

| Data | Retention | Basis |
|---|---|---|
| Rights and support requests (mailbox) | Until answered, then the request, the answer and their dates for 5 years as proof; an ID document is deleted once the request is answered (#290) | Proof of compliance, GDPR art. 5(2). 5 years follows the limitation period of [Code civil art. 2224](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000019017112): our own choice, the article sets no retention |
| Emails at Lettermint | Content, recipient address, metadata and events 28 days after sending; delivery events used for analytics at most 90 days | Lettermint's [DPA](https://lettermint.co/dpa) §3.1, `PROCESSOR_FACTS.lettermintRetention`, checked 2026-11-01 |
| Pages Functions logs at Cloudflare | Not stored: live tail only | [Pages Functions logging](https://developers.cloudflare.com/pages/functions/debugging-and-logging/), checked 2026-10-31 |
| On-device data | Under the user's control; cleared by "Delete local data" or by clearing site data | Not held by the controller |
