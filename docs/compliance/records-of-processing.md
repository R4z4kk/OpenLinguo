# Records of processing (GDPR art. 30(1))

The fewer-than-250-employees exemption (art. 30(5)) does not apply: the processing below is not occasional.

**Controller (art. 30(1)(a))**: `[MAINTAINER NAME]`, `[POSTAL ADDRESS]`, `[CONTACT EMAIL]`. No joint controller, no EU representative needed. No data protection officer: the conditions of art. 37 (public authority, large-scale systematic monitoring, large-scale special categories) are not met.

Processing that happens only on the user's device (learning data, voice, journal, AI key) is not listed: the controller does not receive that data.

## P1 — User accounts

| Item | Content |
|---|---|
| (b) Purposes | Create and manage accounts, authenticate users, send service emails (verification, password reset, inactivity notice) |
| Legal basis | Contract (art. 6(1)(b)) |
| (c) Data subjects | Registered users aged 15 and over |
| (c) Data | Email, pseudonym, password hash, OAuth provider and account id, sessions, age declaration, created and last-active dates |
| (d) Recipients | Maintainer; SMTP provider; Google or GitHub when chosen for sign-in |
| (e) Transfers | United States (Google, GitHub; SMTP provider `[TBD]`) — see [sub-processors](sub-processors.md) |
| (f) Erasure | At account deletion; after 2 years of inactivity with prior notice — see [retention](retention-schedule.md) |
| (g) Security | TLS, hashed passwords, least-privilege database user, secrets as Docker secrets, encrypted backups, rate limiting |

## P2 — Shared library submissions and moderation

| Item | Content |
|---|---|
| (b) Purposes | Receive texts proposed for the public library, moderate them, publish approved texts with attribution |
| Legal basis | Contract (art. 6(1)(b)) |
| (c) Data subjects | Registered users who submit texts |
| (c) Data | Text, chosen attribution name, CC BY-SA 4.0 attestation, submitter account id, moderation status and notes |
| (d) Recipients | Maintainer; the public for approved texts (attribution name only) |
| (e) Transfers | None |
| (f) Erasure | Pending or rejected submissions deleted with the account; published texts stay under CC BY-SA 4.0 with the chosen attribution unless a takedown is requested |
| (g) Security | As P1; plain-text submissions only, size limits, admin-only moderation endpoints |

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
| (c) Data subjects | Everyone calling the API |
| (c) Data | IP address, user agent, timestamp, route, status, authentication events |
| (d) Recipients | Maintainer |
| (e) Transfers | None |
| (f) Erasure | 6 months (CNIL délibération 2021-122 range: 6 months to 1 year) |
| (g) Security | Logs stored on the self-hosted server, access restricted to the maintainer |

## P6 — Rights and support requests

| Item | Content |
|---|---|
| (b) Purposes | Answer access, rectification, erasure and portability requests and support emails |
| Legal basis | Legal obligation (art. 6(1)(c)) for rights requests; legitimate interest for support |
| (c) Data subjects | People who contact the project |
| (c) Data | Email address, message content, request outcome |
| (d) Recipients | Maintainer |
| (e) Transfers | Depends on the mailbox provider `[TBD]` |
| (f) Erasure | `[TBD in M7]`: until the request is closed, plus the period needed to prove it was handled |
| (g) Security | Dedicated mailbox, access restricted to the maintainer |

## P7 — Web app delivery

| Item | Content |
|---|---|
| (b) Purposes | Serve the PWA files |
| Legal basis | Legitimate interest (art. 6(1)(f)) |
| (c) Data subjects | Visitors of the web app |
| (c) Data | IP address and request metadata processed by the CDN |
| (d) Recipients | Cloudflare (processor) |
| (e) Transfers | United States (Cloudflare) — see [sub-processors](sub-processors.md) |
| (f) Erasure | Per Cloudflare's log retention; the project enables no analytics |
| (g) Security | HTTPS only, HSTS, strict CSP |
