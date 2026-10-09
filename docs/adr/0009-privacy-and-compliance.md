# 0009 — Privacy and compliance

- Status: Accepted
- Date: 2026-10-09

## Context

The app processes learning data, voice, and optional accounts for EU users, including teenagers. Legal references were checked on primary texts on 2026-10-09 (see the compliance table in the roadmap). This is not legal advice.

## Decision

- Privacy by design: learning data, recordings, journal and AI key stay on the device.
- Server data is limited to account, sessions, submissions, synced logs, league XP and security logs. Legal bases: contract (GDPR art. 6(1)(b)) and legitimate interest for security logs (art. 6(1)(f)). No consent-based processing in v1.
- Only consent-exempt storage (authentication, CSRF, language/theme), so no cookie banner, and no analytics in v1.
- No third-party runtime requests by default: fonts, stroke data, audio and models come from project origins.
- Accounts are restricted to users aged 15 and over; leagues use pseudonyms and predefined avatars, with no messaging.
- Rights: in-app export and account deletion, profile rectification, contact address.
- Retention: security logs 6 months (CNIL délibération 2021-122), inactive accounts deleted after 2 years with prior notice.
- `docs/compliance/`: records of processing (GDPR art. 30), data map, retention schedule, sub-processors, breach procedure (72 h, art. 33), DPIA screening, privacy policy, legal notices (LCEN art. 1-1).
- AI outputs are labeled and carry machine-readable provenance (AI Act art. 50).

## Consequences

- Minimal personal data on the server reduces breach impact and compliance work.
- Watch items re-checked at M10: décret 2026-883 and the EN 301 549 v4.1.1 Official Journal citation.
