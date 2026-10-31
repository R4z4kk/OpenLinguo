# Records of processing (GDPR art. 30(1))

The fewer-than-250-employees exemption (art. 30(5)) does not apply: the processing below is not occasional.

**Controller (art. 30(1)(a))**: the maintainer, a natural person and non-professional publisher, contact `openlinguo@gmail.com` (`CONTACT_EMAIL` in `packages/core/src/compliance-facts.ts`). This register is public, so the name and postal address are not in it: the maintainer publishes only the host's name and address ([LCEN art. 1-1 II](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000049568614)), and keeps a copy of this register with them outside the repository, given to the CNIL on request (art. 30(4)). No joint controller, no EU representative needed. No data protection officer: the conditions of art. 37 (public authority, large-scale systematic monitoring, large-scale special categories) are not met.

Processing that happens only on the user's device (learning data, voice, journal, AI key) is not listed: the controller does not receive that data. Nor are the requests the learner sends from the device to their own AI provider: OpenLinguo is most likely not a controller of them ([AI features](ai.md)). The same goes for the Wikidata lookup the learner starts with a click: the unknown character sequences of their text, their IP address and their browser go to the Wikimedia Foundation (U.S.), which deletes, aggregates or de-identifies its request logs after at most 90 days, and OpenLinguo receives nothing ([Wikidata lookup](wikidata.md)). That analysis is less firm than the AI one, because the app and not the learner picks the destination: if an authority held OpenLinguo joint controller of the transmission, this lookup would become a processing of its own here.

## P1 — User accounts

| Item | Content |
|---|---|
| (b) Purposes | Create and manage accounts, authenticate users without passwords (6-digit code by email, Google, GitHub), send service emails (sign-in codes, inactivity notice) |
| Legal basis | Contract (art. 6(1)(b)) |
| (c) Data subjects | Registered users aged 15 and over, by self-declaration right after the first sign-in |
| (c) Data | Email, pseudonym, Google or GitHub account id, sessions (IP address, user agent), sign-in codes (hashed), date of the age declaration, role and ban status, optional TOTP secret and backup codes (encrypted), created and updated dates |
| (d) Recipients | Maintainer; Cloudflare (processor, D1 in the `eu` jurisdiction); Scaleway (processor, sign-in emails); Google Ireland or GitHub when chosen for sign-in, as independent controllers |
| (e) Transfers | Cloudflare, Inc. (U.S. company, DPF and SCCs) for requests its network handles outside the EU; none for Scaleway, which processes in France; the exchange with Google Ireland is not a transfer; GitHub, Inc. or GitHub B.V., DPF — see [sub-processors](sub-processors.md) |
| (f) Erasure | At account deletion; after 2 years of inactivity with prior notice — see [retention](retention-schedule.md) |
| (g) Security | TLS; no passwords; codes hashed, valid 10 minutes, 3 attempts; cookies `Secure; HttpOnly; SameSite=Lax`; origin check on every state-changing request; rate limits per IP address; secrets as encrypted Pages secrets; no provider token kept; TOTP mandatory for the admin (CNIL recommendation 2025-019), optional for others, asked on every new session once on; the admin role is granted outside the app |

## P2 — Shared library submissions and moderation

| Item | Content |
|---|---|
| (b) Purposes | Receive texts proposed for the public library, moderate them, publish approved texts with attribution |
| Legal basis | Contract (art. 6(1)(b)) |
| (c) Data subjects | Registered users who submit texts |
| (c) Data | Title and plain text, origin with the AI provenance of a story, licence fixed by the origin (CC BY-SA 4.0 or CC0 1.0), attribution (pseudonym or anonymous), attestation version and time, submitter account id, moderation status, estimated HSK band and publication time, statements of reasons for rejections and removals (DSA art. 17(3), #274) |
| (d) Recipients | Maintainer; the public for approved texts (attribution name only); Scaleway (processor) for the statement of reasons emailed to the submitter |
| (e) Transfers | As P1 for Cloudflare |
| (f) Erasure | Pending or rejected submissions deleted with the account; statements of reasons 1 year after the decision; published texts stay under their licence (CC BY-SA 4.0, or CC0 1.0 for a story) with the chosen attribution unless removed — see [retention](retention-schedule.md) |
| (g) Security | As P1; plain text only, at most 20,000 characters, at most 5 pending per account, admin-only moderation endpoints |

## P2b — Notices and action

| Item | Content |
|---|---|
| (b) Purposes | Receive reports of illegal content or of texts against the library rules, decide on them, tell the notifier and the submitter (DSA arts 16 and 17), report serious offences to the authorities (LCEN art. 6 IV.A, DSA art. 18), execute removal orders (LCEN art. 6-1, Regulation 2021/784) — see the [moderation runbook](moderation.md) |
| Legal basis | Legal obligation (art. 6(1)(c)): DSA art. 16 and 17, LCEN art. 6 |
| (c) Data subjects | Anyone who reports a text, with no account; the submitter of the text reported |
| (c) Data | The text concerned, the reasons, the notifier's name and email (optional for child sexual abuse material, DSA art. 16(2)(c)), the good-faith statement, the time, the decision and its statement of reasons; for a removal order, the order and the text removed |
| (d) Recipients | Maintainer; Scaleway (processor) for the receipt and the decision; the submitter receives the statement of reasons, never the notice or the notifier's identity; the competent authorities for a report under LCEN art. 6 IV.A or DSA art. 18 |
| (e) Transfers | As P1 for Cloudflare |
| (f) Erasure | 1 year after the decision, by the daily jobs (#278); a text removed on a terrorist content removal order and its related data kept 6 months (Regulation 2021/784 art. 6(2)) |
| (g) Security | As P1; `POST /api/notices` rate limited; notices readable only on admin routes |

## P8 — Hosting records (décret 2021-1362)

| Item | Content |
|---|---|
| (b) Purposes | Keep the data that identifies whoever created, edited or deleted hosted content, for a judicial or administrative request (LCEN art. 6 V, décret 2021-1362 arts 5 to 8) |
| Legal basis | Legal obligation (art. 6(1)(c)) |
| (c) Data subjects | Registered users who submit or withdraw texts |
| (c) Data | Account id, submission id, operation, IP address, HTTP and TLS versions, time; when an account that submitted is deleted, its email and pseudonym, sealed; only what is already collected (art. 8: "dans la mesure où elles sont collectées") |
| (d) Recipients | Maintainer, only to answer an authority |
| (e) Transfers | None |
| (f) Erasure | Connection records 1 year after the operation (art. 5), kept when the text or the account is deleted; sealed pseudonym 1 year (art. 3) and sealed email 5 years (art. 2) after the account is deleted; by the daily jobs (#278) |
| (g) Security | In D1 (`eu` jurisdiction), no foreign key to the account, read only by the jobs and the admin export |

## P3 — Sync (M8)

| Item | Content |
|---|---|
| (b) Purposes | Keep cards and review history consistent across the user's devices |
| Legal basis | Contract (art. 6(1)(b)), opt-in feature |
| (c) Data subjects | Users who enable sync |
| (c) Data | Card content, append-only review log |
| (d) Recipients | Maintainer (operations only) |
| (e) Transfers | None |
| (f) Erasure | At account deletion or when sync is disabled and data deleted by the user |
| (g) Security | As P1 |

## P4 — Leagues (M8)

| Item | Content |
|---|---|
| (b) Purposes | Weekly opt-in leagues ranking learners by XP |
| Legal basis | Contract (art. 6(1)(b)), opt-in feature |
| (c) Data subjects | Users who join leagues |
| (c) Data | Pseudonym, predefined avatar id, weekly XP recomputed from synced review logs, league placement |
| (d) Recipients | Maintainer; other members of the same league (pseudonym, avatar, XP) |
| (e) Transfers | None |
| (f) Erasure | Weekly results kept 12 weeks; all entries deleted when the user leaves leagues or deletes the account |
| (g) Security | As P1; no messaging, no free-text profile, no uploaded avatars |

## P5 — Security logs

| Item | Content |
|---|---|
| (b) Purposes | Detect and investigate abuse and intrusions |
| Legal basis | Legitimate interest (art. 6(1)(f)) |
| (c) Data subjects | Everyone who signs in, asks for a sign-in code or enters an authenticator code; accounts an admin action concerns |
| (c) Data | Sign-in, failed sign-in, code-sent, authenticator and admin-action events: method or operation, account id when known, account concerned by an admin action, IP address, user agent, failure code, time; rate-limit counters per IP address and route |
| (d) Recipients | Maintainer; Cloudflare (processor) |
| (e) Transfers | None |
| (f) Erasure | 6 months (CNIL [« Tracer les opérations »](https://www.cnil.fr/fr/securite-tracer-les-operations): "entre six mois et un an"), by the daily jobs (#278); rate-limit counters after their window, by the same jobs. The data subject may object (art. 21), as the privacy notice says |
| (g) Security | In D1 (`eu` jurisdiction); readable by the maintainer only; the account id is cleared when the account is deleted |

## P6 — Rights and support requests

| Item | Content |
|---|---|
| (b) Purposes | Answer access, rectification, erasure and portability requests and support emails |
| Legal basis | Legal obligation (art. 6(1)(c)) for rights requests; legitimate interest for support |
| (c) Data subjects | People who contact the project |
| (c) Data | Email address, message content, request outcome |
| (d) Recipients | Maintainer |
| (e) Transfers | The mailbox is a Gmail account: Google Ireland Limited for EEA users, under Google's own terms; Google LLC, active on the DPF list (due 2027-09-13), may process the mail in the U.S. — see [sub-processors](sub-processors.md) |
| (f) Erasure | Until answered, then the request, the answer and their dates for 5 years as proof; an ID document deleted once the request is answered (#290) |
| (g) Security | Dedicated mailbox, access restricted to the maintainer; procedures in #290 |

## P7 — Web app delivery

| Item | Content |
|---|---|
| (b) Purposes | Serve the PWA files and route API requests |
| Legal basis | Legitimate interest (art. 6(1)(f)) |
| (c) Data subjects | Visitors of the web app |
| (c) Data | IP address and request metadata processed by the CDN |
| (d) Recipients | Cloudflare (processor) |
| (e) Transfers | Cloudflare, Inc. (U.S. company, DPF and SCCs) — see [sub-processors](sub-processors.md) |
| (f) Erasure | Pages Functions logs are not stored; the project enables no analytics, and neither `wrangler.jsonc` turns on Workers Logs |
| (g) Security | HTTPS only, HSTS, strict CSP |
