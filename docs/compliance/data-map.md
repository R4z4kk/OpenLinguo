# Data map

## On the device only

Stored in the browser (IndexedDB). Never sent to the OpenLinguo server unless the user enables sync (M8), and then only the items marked *synced*.

| Data | Personal | Notes |
|---|---|---|
| Dictionary, levels, stroke data, audio packs | No | Public datasets, cached offline |
| Cards and their content | Yes (learning data) | Synced if sync is on |
| Review log (append-only) | Yes (learning data) | Synced if sync is on; XP is derived from it |
| Personal decks: names typed by the learner, words filed in them | Yes (learning data) | Synced if sync is on |
| Imported Anki decks: the words matched in the `.apkg`, the notes added as cards of their own, their audio and, when the learner chooses it, their review history | Yes (learning data) | The file is read on the device and never uploaded; only the text of notes added as cards is kept. Imported reviews join the review log, dated in the device's time zone. Audio stays on the device, is not in the backup file and is deleted with its deck |
| Personal vocabulary profile (interests, profession) | Yes | Never synced; sent only to the user's own AI provider when they ask for suggestions |
| Journal and 5-sentence answers | Yes | Never synced; sent only to the user's own AI provider for correction |
| Voice recordings and pitch curves | Yes (voice) | Processed on the device (Whisper, pitch); never uploaded |
| AI provider endpoint and key | Secret | Never leaves the device except to that provider |
| Preferences (language, theme, tone colors, Anki field and card template choices per note type) | No | Consent-exempt UI personalization |
| Backup file (JSON, exported from Profile) | Yes (learning data) | Cards, review log, personal decks and settings, no dictionary data. Saved wherever the user chooses; OpenLinguo never receives it. Import merges by ids |

## On the OpenLinguo server (from M7)

| Data | Source | Who can see it |
|---|---|---|
| Account: email, pseudonym, password hash, OAuth provider id, sessions, created and last-active dates | Sign-up, sign-in | Maintainer (admin) |
| Age declaration (15+) | Sign-up checkbox | Maintainer |
| Library submissions: text, attribution name, license attestation, moderation status and notes | Submit to library | Maintainer; published texts are public |
| Synced cards and review log (M8) | Sync | Maintainer (operations only) |
| League entries: pseudonym, predefined avatar id, weekly XP (M8) | Recomputed from synced review logs | Other league members see pseudonym, avatar and XP |
| Security logs: IP address, user agent, timestamp, route, auth events | Every API request | Maintainer |
| Rights and support requests | Email | Maintainer |

## With third parties

| Party | What they receive | When |
|---|---|---|
| User's AI provider (BYOK) | Prompt text: sentences, journal, interests, story requests | Only when the user triggers an AI feature, after a notice naming the endpoint |
| Cloudflare (PWA hosting) | IP address and request metadata of every page load | Always, as the CDN serving the app |
| Google, GitHub (OAuth) | Sign-in exchange | Only if the user chooses that sign-in method |
| SMTP provider `[TBD in M7]` | Email address, message content | Verification, password reset, inactivity notice |

No analytics, no ads, no third-party fonts or scripts at runtime.

## Data portability

The backup export gives the learner their cards, review log and decks "in a structured, commonly used and machine-readable format" (GDPR art. 20(1), [EUR-Lex 32016R0679](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679)). Art. 20 binds a controller only for data it processes; from M8 the same export covers synced data.
