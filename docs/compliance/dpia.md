# DPIA: accounts, shared library and leagues

Data protection impact assessment (GDPR art. 35) of the server added in M7 ([ADR 0015](../adr/0015-backend-and-shared-library.md), #280) and of the weekly leagues planned for M8. It follows the CNIL PIA method: context, fundamental principles, risks, validation. Every source below was read on its official site on 2026-10-31. This is not legal advice. When a change touches accounts, the library, the hosting records or the leagues, update this document in the same pull request.

## Sources

Method:

- CNIL, [PIA, la méthode](https://www.cnil.fr/sites/default/files/atoms/files/cnil-pia-1-fr-methode.pdf), [les modèles](https://www.cnil.fr/sites/default/files/atoms/files/cnil-pia-2-fr-modeles.pdf) and [les bases de connaissances](https://www.cnil.fr/sites/default/files/atoms/files/cnil-pia-3-fr-basesdeconnaissances.pdf), February 2018 edition: the four steps, the three feared events, the severity and likelihood scales (section 1.4 and 1.5 of the knowledge base).
- CNIL, [Ce qu'il faut savoir sur l'AIPD](https://www.cnil.fr/fr/ce-quil-faut-savoir-sur-lanalyse-dimpact-relative-la-protection-des-donnees-aipd) (2017-10-18): "au moins deux des neuf critères"; send the DPIA to the CNIL when the residual risk stays high.
- WP29, [Guidelines on DPIA](https://ec.europa.eu/newsroom/just/document.cfm?doc_id=47711), WP248 rev.01 (revised 2017-10-04, endorsed by the [EDPB](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/data-protection-impact-assessments-high-risk-processing_en) on 2018-05-25): the nine criteria; "a processing meeting two criteria would require a DPIA" in most cases; publishing a summary is good practice.
- Not used: the EDPB [Template for DPIA](https://www.edpb.europa.eu/system/files/2026-05/edpb_dpia_template_explainer_2026_v1_en.pdf), version 1.0 of 2026-03-10, adopted "for public consultation", not final.

Law and guidance:

- [GDPR](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679): art. 35(1) "prior to the processing", 35(7) minimum content, 35(9) views of data subjects, 35(11) review "at least when there is a change of the risk", 36(1) prior consultation; art. 8(1) applies "Where point (a) of Article 6(1) applies"; recitals 38 (children "merit specific protection") and 75.
- CNIL délibérations [2018-327](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000037559521) (2018-10-11, list of processing that requires a DPIA, "caractère non-exhaustif") and [2019-118](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000039248939) (2019-09-12, list of exempted processing): no entry matches.
- [Décret 2021-1362](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000044228912) (text last updated 2021-10-21, in force on 2026-10-31): art. 2, 3, 5, 7, 8.
- [LCEN art. 6](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000801164) (version in force since 2026-08-26): V.A "détiennent et conservent" the data identifying "quiconque a contribué" to a content; V.B, one year and €250,000.
- CNIL recommendations on minors: [1](https://www.cnil.fr/fr/recommandation-1-encadrer-la-capacite-dagir-des-mineurs-en-ligne) (2021-06-01, marked "en cours de mise à jour"), [6](https://www.cnil.fr/fr/recommandation-6-renforcer-linformation-et-les-droits-des-mineurs-par-le-design) (2021-06-09), [7](https://www.cnil.fr/fr/recommandation-7-verifier-lage-de-lenfant-et-laccord-des-parents-dans-le-respect-de-sa-vie-privee) (2021-06-01), [8](https://www.cnil.fr/fr/recommandation-8-prevoir-des-garanties-specifiques-pour-proteger-linteret-de-lenfant) (2021-06-09).
- [Code civil art. 1148](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041055) (version of 2016-10-01): a person unable to contract may still conclude "les actes courants autorisés par la loi ou l'usage".
- [Loi 2023-566 art. 7](https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000047799540): in force "à une date fixée par décret", none published; [décision 2026-911 DC](https://www.legifrance.gouv.fr/cons/id/CONSTEXT000054952977) (2026-08-14) struck down art. 1 of loi 2026-813. No French age threshold for online services is in force.
- Commission [guidelines on art. 28 DSA](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:C_202505519), C/2025/5519 (OJ of 2025-10-10): para 8, art. 28(1) does not apply to micro and small platforms; para 52, self-declaration is not an appropriate age assurance method under art. 28; para 57, "streaks" off by default for minors; para 61, no persuasive design "aimed predominantly at engagement". Followed here as good practice only.
- CNIL, [Sécurité : tracer les opérations](https://www.cnil.fr/fr/securite-tracer-les-operations) (2024-03-14): logs kept "sur une période glissante comprise entre six mois et un an".
- CNIL délibération [2021-131](https://www.legifrance.gouv.fr/cnil/id/CNILTEXT000045543374/) (2021-09-23): two years of inactivity "apparait proportionné"; not binding.
- EDPB, [CEF 2025 report on the right to erasure](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf) (2026-02-10), issue 6: keep track of erasures and apply them on restored systems.

Provider facts (Cloudflare D1 `eu` jurisdiction, DPAs, Data Privacy Framework status, Lettermint's processing in the EU) were re-read on their own pages on 2026-10-31 (Lettermint on 2026-11-01, when it replaced Scaleway) and are dated in [sub-processors](sub-processors.md) and `packages/core/src/compliance-facts.ts` (#279).

## Why a DPIA

| WP248 criterion | M7 (accounts, library) | M8 (leagues) |
|---|---|---|
| 1. Evaluation or scoring | No: the level estimate scores texts, not people | **Yes**: learners ranked by XP |
| 7. Vulnerable data subjects | **Yes**: accounts from 15 | **Yes** |
| Others | No ([screening](dpia-screening.md)) | No |

M7 alone meets one criterion and no entry of the CNIL lists, so a DPIA is not mandatory for it. The M8 leagues meet two: a DPIA is required before they process any data. M8 reuses the M7 accounts, so one assessment covers both, written now as WP248 asks ("as early as is practicable"), and completed with the real M8 design before leagues open (#296).

## 1. Context

### 1.1 Overview

OpenLinguo is a free, open-source, local-first app for learning Chinese. Everything works on the device without an account. M7 adds optional accounts, used to submit texts to a shared library moderated by the maintainer; M8 adds sync between devices and weekly leagues, both opt-in.

- **Controller**: the maintainer, a natural person, non-professional publisher (LCEN art. 1-1 II). No processor of their own staff, no DPO (art. 37 not met).
- **Processors**: Cloudflare, Inc. (Pages Functions, D1 database in the `eu` jurisdiction, cron Worker), under its DPA, part of the self-serve terms; Lettermint B.V. (transactional email, email data processed in the EU), under the DPA that is part of its terms.
- **Independent controllers** when the learner chooses them for sign-in: Google Ireland Limited for EEA users, GitHub, Inc. or GitHub B.V.
- **Benefits**: for learners, texts graded to their level written by other learners, and later the same cards on every device; for the project, a library without any third-party content licence.
- **Applicable frameworks**: no approved code of conduct or certification (art. 40, 42). The CNIL guidance and the platform law listed in the sources.

### 1.2 Data, processes and supports

| Data | Who | Source | Recipients | Retention |
|---|---|---|---|---|
| Account: email, pseudonym, Google or GitHub account id, date of the age declaration, created and updated dates | Account holders, 15 and over | The person; Google or GitHub at sign-in (provider tokens are dropped) | Maintainer, Cloudflare | Until deletion; 2 years without action, with an email 30 days before |
| Age answer « moins de 15 ans » | Anyone who signs in | The person | None | The account is deleted at once; nothing is kept but the security events, whose account id is cleared |
| Sessions: token, expiry, IP address, user agent | Account holders | Browser | Maintainer, Cloudflare | Until sign-out or expiry |
| Sign-in codes (hashed) and verification tokens | People who ask for a code | Server | Lettermint (the code, in the email) | 10 minutes; purged at expiry |
| TOTP secret and backup codes | The admin; account holders who turn it on | Server | None | Until turned off or account deleted |
| Security events: sign-ins, failures, codes sent, admin actions, with IP address, user agent, account id | Everyone who signs in or asks for a code; the admin | Server | Maintainer, Cloudflare | 6 months |
| Rate-limit counters: IP address and route | Every caller of the auth routes | Server | Cloudflare | Purged after their window |
| Submissions: title, text, origin, licence, attribution (pseudonym or anonymous), attestation version and time, status, estimated band | Submitters | The person; the admin's estimate | Maintainer; the public once approved (text, attribution) | Pending and rejected: deleted with the account. Published: kept under their licence; at deletion the person chooses name, anonymous (default) or removal |
| Decisions: statements of reasons (DSA art. 17) | Submitters | Admin | Submitter by email | 1 year after the decision |
| Notices: text concerned, reasons, name and email (optional for child sexual abuse material) | Anyone, with no account | The person | Maintainer; the submitter gets the statement of reasons, not the notice | 1 year after the decision |
| Hosting records (décret 2021-1362): per creation, edit or deletion of a submission, account id, submission id, operation, IP address, source port when Cloudflare passes it, time | Submitters | Server | Readable by the daily jobs and by the admin export for an authority only | 1 year |
| Sealed identity (décret 2021-1362) when an account that submitted is deleted: email, pseudonym | Former submitters | Account | As hosting records | Email 5 years, pseudonym 1 year |
| Erasure log: ids of what was erased, time | Deleted accounts | Server | None | 8 days, re-applied after a Time Travel restore |
| M8: synced cards and append-only review log | Learners who turn sync on | Device | Maintainer (operations only), Cloudflare | Until sync is turned off and the data deleted, or the account deleted |
| M8: league name, predefined avatar, weekly XP, league placement | Learners who join leagues | Server, from the synced log | Members of the same league | 12 weeks; deleted when leaving |
| Rights and support requests | People who write | The person | Maintainer | Until answered, then a minimal proof for 5 years |

Not on the server: learning data unless sync is on, voice, journal, AI key and AI requests, Wikidata lookups ([data map](data-map.md)).

**Life cycle.** A person signs in with a code by email, Google or GitHub; right after the first sign-in they answer the age step, and every route except that step and deletion answers 403 until they do. They may submit a local text; the admin reviews it in `/admin` with a TOTP-verified session, approves it or rejects it with a statement of reasons. Anyone may report a published text without an account. The person may export their data as JSON and delete their account at any time. The cron Worker purges each category daily and records each run; `/api/health` answers 503 when a job fails or is late.

**Supports.** The PWA in the browser; Cloudflare Pages Functions (Hono, Better Auth, Drizzle) on `openlinguo.razakk.fr`; one D1 database, `eu` jurisdiction, with D1 Time Travel (7 days) as the only backup; the cron Worker; Lettermint's email API; the maintainer's Cloudflare and GitHub accounts and the `production` deploy environment; the maintainer's mailbox for requests.

## 2. Fundamental principles

### 2.1 Proportionality and necessity

| Requirement | Measure | Assessment |
|---|---|---|
| Purposes (art. 5(1)(b)) | Accounts to submit and moderate library texts, to sync and to join leagues; security; legal retention of hosts; answering requests. No advertising, profiling, analytics or resale | Adequate |
| Legal basis (art. 6) | Contract, art. 6(1)(b): account, library, sync, leagues. Legitimate interest, 6(1)(f): security events, rate limits. Legal obligation, 6(1)(c): hosting records and sealed identity (LCEN art. 6 V.A, décret 2021-1362), rights requests. No processing rests on consent, so art. 8 GDPR and art. 45 Loi Informatique et Libertés do not apply; what counts is a minor's capacity to contract (Code civil art. 1148), which the CNIL accepts from 15 under four conditions (recommendation 1, see 2.2) | Adequate |
| Minimisation (art. 5(1)(c)) | No password, no birth date, no real name, no photo, no free-text profile; the account name and image from Google or GitHub are blanked at creation, provider tokens dropped; the age step keeps only the date of the declaration; hosting records keep only what is already collected ("dans la mesure où elles sont collectées", décret art. 8); a notice needs no account; leagues show a name, an avatar and weekly XP, never times | Adequate; #292 adds anonymous attribution by default, #295 a league name separate from the library pseudonym |
| Accuracy (art. 5(1)(d)) | Email verified by the code or the provider; pseudonym editable (#272); a published text's attribution follows the person's choice | Adequate |
| Storage limitation (art. 5(1)(e)) | The retention column above, enforced by the daily jobs (#278), each run recorded and a failure turning `/api/health` to 503; security events at the low end of the CNIL range; inactivity at the CNIL reference of 2 years | Adequate |

### 2.2 Rights of the data subjects

| Requirement | Measure | Assessment |
|---|---|---|
| Information (art. 12, 13) | Privacy notice and terms in French and English written for a 15-year-old reader, with the essentials shown at sign-up and at the moment they matter (#279, CNIL recommendation 6); the deletion screen says what is kept and why (#277); the league explainer before joining (#295) | Planned |
| Consent (art. 7, 8) | Not used. Emails carry no tracking pixel, so none is needed for them | Not applicable |
| Minors | The four conditions of CNIL recommendation 1: a service adapted to minors (no messaging, ads, profiling, uploaded images or public profile; leagues opt-in); strict data protection (this assessment); clear information (#279); a way for parents to ask for their child's account to be deleted (#279 in the notice, #290 for the procedure). Age by self-declaration in neutral words, nothing preselected (recommendations 6 and 7), see risk R7 | Planned |
| Access and portability (art. 15, 20) | `GET /api/account/export`: account, sessions, submissions, decisions, as JSON (#277) | Planned |
| Rectification and erasure (art. 16, 17) | Pseudonym in Profile (#272); deletion cascades at once, with the choice for published texts (#277); erasure log re-applied after a restore, as the EDPB asks; requests by email answered within one month (#290) | Planned |
| Restriction and objection (art. 18, 21) | Objection to security events is open (legitimate interest) and stated in the notice (#279); hosting records rest on a legal obligation, so art. 21 does not apply to them | Planned |
| Processors (art. 28) | Cloudflare and Lettermint DPAs, checked and dated in #279 and on 2026-11-01 ([sub-processors](sub-processors.md)) | Done |
| Transfers (art. 44–49) | D1 runs and stores data in the EU; Cloudflare, Inc. is a U.S. company on the Data Privacy Framework list, its DPA falls back on the SCCs; Google and GitHub are chosen by the learner and act as independent controllers. Statuses dated with a CI check in #279 | Done |

## 3. Risks

Scales of the CNIL knowledge base, 1 to 4. Severity: 1 negligible, 2 limited, 3 significant, 4 maximum. Likelihood: 1 negligible, 2 limited, 3 significant, 4 maximum. The method leaves the acceptance threshold to the controller; here a risk is high when severity and likelihood are both 3 or more, or either is 4.

### 3.1 Existing and planned measures

| Kind | Measure | Where |
|---|---|---|
| On the data | No passwords; codes hashed, 10 minutes, 3 attempts; codes capped per IP address and per email address (10 a day, counted by a keyed hash of the address) | #270, #289 |
| | Cookies `Secure; HttpOnly; SameSite=Lax`; origin check on state-changing requests | #270 |
| | Admin role granted by command only, TOTP mandatory on every admin route; admin actions logged | #271 |
| | Hosting records in their own table, readable only by the jobs and the admin export for an authority; every export and direct read in an access register | #273, #277, #290 |
| | Plain-text submissions, 20,000 characters, 5 pending per account; every text approved before publication | #273, #274 |
| On the system | TLS, HSTS, strict CSP, API on the PWA's own origin; D1 in the `eu` jurisdiction; secrets as encrypted Pages secrets | #268, #269 |
| | Deploy only from `main` with the maintainer's approval; Cloudflare token scoped to Pages and D1; no preview deployment sharing the database | #269 |
| | Daily purges recorded, `/api/health` 503 on failure, Uptime Kuma alert | #278 |
| | D1 Time Travel, 7 days; erasure log re-applied after a restore | #269, #277 |
| Organisation | Sign-ups closed by default (`SIGNUPS_OPEN=false`) until the measures below are merged | #281 |
| | Cloudflare and GitHub accounts secured, direct database reads only for a recorded reason | #291 |
| | Breach procedure covering the server, notice template for teenagers | #293 |
| | Runbooks for rights, parents' and authorities' requests; moderation runbook | #290, #279 |

### 3.2 Security risks

**R1. Illegitimate access to data.**

- Impacts: a teenager's email linked to their pseudonym and published texts; unwanted messages or phishing aimed at them; an approximate location from IP addresses; sealed data of former accounts exposed.
- Threats and sources: guessing sign-in codes from many IP addresses (external attacker); takeover of the maintainer's Cloudflare or GitHub account, whose D1 console reads every table without the app's TOTP; a flaw in the API or a dependency; theft of the admin session; misuse by the maintainer; a processor.
- Severity 2: no special category, no financial data, but minors, which raises it from 1.
- Likelihood 2 before the new measures: no password to steal, TOTP for the admin, but codes capped per IP address only and the dashboard as a path around the TOTP. With #289, #290 and #291: 1.
- **Residual: severity 2, likelihood 1. Acceptable.**

**R2. Unwanted modification of data.**

- Impacts: a text published under someone else's pseudonym; a pseudonym changed or an account deleted by an intruder; decisions altered; in M8, league XP falsified.
- Threats and sources: takeover of a learner's mailbox (outside the service) or of the admin account; a flaw in the API.
- Severity 2. Likelihood 1: every text is approved before it is published, admin routes need TOTP, XP is recomputed by the server from the log with plausibility caps (M8).
- **Residual: severity 2, likelihood 1. Acceptable.**

**R3. Loss of data.**

- Impacts: an account to create again; library texts gone from the server, while imported copies stay on devices; hosting records lost, which is a legal failure of the controller rather than a harm to the person; the erasure log lost, which could bring back erased data after a restore.
- Threats and sources: a failed migration, a deletion by mistake, loss of the Cloudflare account, an outage.
- Severity 1: learning data lives on the device, an account holds little. Likelihood 2: Time Travel keeps only 7 days and there is no other copy, a choice of ADR 0015.
- **Residual: severity 1, likelihood 2. Accepted.** #291 lowers the account-loss path.

### 3.3 Other risks to rights and freedoms

**R4. A teenager identifies themselves in public.** A text or a pseudonym can carry a full name, a school or a town; once published under CC BY-SA 4.0, copies are irrevocable and stay on devices after a removal.

- Severity 3: contact by strangers, harassment, and the copies cannot be called back. Likelihood 2 before measures.
- Measures: attribution anonymous by default and a warning next to the pseudonym (#292); a checklist line for the submitter's own data, then rejection with reasons (#292, #274); notice and action for what slips through (#276).
- **Residual: severity 3, likelihood 1. Acceptable.**

**R5. Leagues: comparison and pressure (M8).** A ranking can push a teenager to overuse the app or discourage them; a table that showed activity would reveal routines.

- Severity 2. Likelihood 3 without measures: a ranking is an engagement feature by nature.
- Measures (#295): off by default, joined after a plain explainer, never prompted; no notification about rank; weekly XP only, never times or streaks; the league can be hidden; leaving deletes the entries; caps never exclude anyone automatically.
- **Residual: severity 2, likelihood 2. Acceptable, to be re-assessed with the real design (#296).**

**R6. Linking a league to the library (M8).** If the league shows the library pseudonym, other members can link a teenager's activity to their public texts, or recognise a classmate.

- Severity 2. Likelihood 2. Measure: a league name separate from the library attribution, random by default (#295).
- **Residual: severity 2, likelihood 1. Acceptable.**

**R7. A child under 15 gets through the age step.** The CNIL notes that declarative checks are "trop aisément contournés" (recommendation 7), and the Commission does not count self-declaration as age assurance under art. 28 DSA (para 52), which does not bind a micro platform (para 8).

- Severity 2: the service has no messaging, ads, profiling or public profile; the person can at worst publish a moderated text or, in M8, appear under a random name in a league.
- Likelihood 3.
- Measures: neutral wording with nothing preselected; « moins de 15 ans » deletes the account at once; a channel for parents to have an account deleted (#279, #290). A stronger check (an ID document, a face estimate) would collect more data than the whole account, which recommendation 7 ("strictement nécessaire") and the minimisation principle rule out for a service of this risk; the Conseil constitutionnel also struck down a general age requirement with no safeguards for the checks it implied (2026-911 DC).
- **Residual: severity 2, likelihood 3. Acceptable.**

**R8. Data that outlives the deletion of an account.** Décret 2021-1362 keeps, for an account that submitted, its email for 5 years, its pseudonym and the connection records for 1 year. A person may believe everything is gone.

- Severity 2 if those data leak. Likelihood 1: a separate table, no reading path in the app, every export registered (#290), only accounts that submitted, only data already collected.
- Measures: the deletion screen and the notice say what is kept, why and how long (#277, #279).
- **Residual: severity 2, likelihood 1. Acceptable.**

## 4. Validation

### 4.1 Risk map after measures

| Severity \ Likelihood | 1 negligible | 2 limited | 3 significant | 4 maximum |
|---|---|---|---|---|
| 4 maximum | | | | |
| 3 significant | R4 | | | |
| 2 limited | R1, R2, R6, R8 | R5 | R7 | |
| 1 negligible | | R3 | | |

No residual risk is high. Prior consultation of the CNIL (art. 36(1)) is not needed.

### 4.2 Action plan

Owner of every measure: the maintainer. Cost: S is a day or less, M a few days.

| Measure | Issue | Cost | Deadline |
|---|---|---|---|
| Sign-in codes capped per email address | #289 | S | Before sign-ups open |
| Runbook for rights, parents' and authorities' requests, with the access register | #290 | S | Before sign-ups open |
| Cloudflare and GitHub accounts secured | #291 | S | Before sign-ups open |
| Anonymous attribution by default, identity warning, checklist line | #292 | S | Before sign-ups open |
| Breach procedure for the server, notice for teenagers | #293 | S | Before sign-ups open |
| DPIA review date checked in CI | #294 | S | With #279 |
| Leagues private by default | #295 | M | Before leagues open |
| DPIA completed with the M8 design | #296 | S | Before leagues open |

Already tracked: age step, security events and sign-ups flag (#270), admin TOTP (#271), hosting records (#273), moderation and statements of reasons (#274), notice and action (#276), export, deletion and erasure log (#277), retention jobs (#278), legal pages, notice and compliance documents (#279). #281 opens sign-ups only once #279, #280 and #289 to #293 are merged.

**Stakeholders.** No DPO is designated (art. 35(2) not applicable). Data subjects' views (art. 35(9), "where appropriate"): this assessment is public in the repository, as WP248 recommends, and anyone may comment through an issue; no formal consultation is held for a one-person non-commercial project.

### 4.3 Decision and review

- **Accounts and library (M7): validated**, on condition that #289 to #293 are merged before sign-ups open, which #281 enforces.
- **Leagues (M8): not yet validated.** The measures of #295 are required; leagues stay off in production until #296 completes this assessment with the real design.
- The maintainer's validation is recorded by merging the pull request that adds or changes this document.
- **Review by 2027-10-31** (`DPIA_REVIEW` in `packages/core/src/compliance-facts.ts`: a unit test fails from that date, #294), or earlier when:
  - the risk changes (art. 35(11)): a new category of data, a new recipient, a change of host or of retention;
  - leagues or sync are designed (#296);
  - the CNIL publishes the update of its recommendations on minors (recommendation 1 is "en cours de mise à jour");
  - a French age threshold for online services enters into force (loi 2023-566 or a new law);
  - accounts grow enough to reconsider "large scale" (WP248 criterion 5).
