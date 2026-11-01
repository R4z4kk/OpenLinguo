# Data map

## On the device only

Stored in the browser (IndexedDB). Never sent to the OpenLinguo server unless the user enables sync (M8), and then only the items marked *synced*.

| Data | Personal | Notes |
|---|---|---|
| Dictionary, levels, stroke data, audio packs | No | Public datasets, cached offline |
| Speech recognition model (Paraformer files and the sherpa-onnx WebAssembly binary) | No | Downloaded only when the learner asks, after its size is shown, from the app's origin; kept in the Cache API, removed by « Delete speech recognition » (#119) |
| Cards and their content | Yes (learning data) | Synced if sync is on; a card made from a corrected sentence keeps the correction's provenance (#186) |
| Review log (append-only) | Yes (learning data) | Synced if sync is on; XP is derived from it |
| Personal decks: names typed by the learner, words filed in them | Yes (learning data) | Synced if sync is on |
| Imported Anki decks: the words matched in the `.apkg`, the notes added as cards of their own, their audio and, when the learner chooses it, their review history | Yes (learning data) | The file is read on the device and never uploaded; only the text of notes added as cards is kept. Imported reviews join the review log, dated in the device's time zone. Audio stays on the device, is not in the backup file and is deleted with its deck |
| Interests: the themes ticked and one short free field of 120 characters (#187) | Yes | In the browser's local storage and the backup file, never synced; sent to the learner's AI provider only when they press « Suggest words », with their level, after the same warning as the journal. The suggested words are dictionary entries, filed in a personal deck only when the learner adds them |
| 5-sentence challenges: the word and the 5 sentences (#184) | Yes | In the backup file, never synced; sent to the learner's AI provider only when they press « Correct » |
| Journal: one entry per learning day (#185) | Yes | Same as the challenges. Free text can reveal special categories (GDPR art. 9): the AI notice and the line under the field warn against health, religion, politics and sex life |
| Texts: the title and body of each text the learner pastes or imports as a `.txt`, its chosen readings, and for a story its provenance (#226); « Je connais » marks: a word reading and the date (#226) | Yes | The text is free text and can reveal special categories (GDPR art. 9), but the reader works on the device and sends nothing by itself. Only when the learner presses « Demander à l'IA » (#231), the sentences around the unknown sequences go to their AI provider. In the backup file, never synced. A `.txt` is read on the device and never uploaded; « Delete » on a text removes it and its chosen readings, not the marks, the cards or the lexicon. A backup made earlier still holds a deleted text |
| Wikidata answers: per unknown sequence of a text, the items found (type, description in the interface language, item id) or none, and the date (#230); the personal lexicon entries the learner accepted from them keep `source: "wikidata"` | Yes (derived from the learner's text) | In the backup file, never synced; received from Wikidata, never sent anywhere else. That the Wikidata notice was shown is kept with the AI notice flag: consent-exempt storage, not in the backup |
| AI corrections: per sentence, the corrected text, each change with its explanation, pinyin and French meaning, « Accept » or « Keep mine », and the provenance (#183) | Yes (derived from the learner's text) | In the backup file with the challenge or entry they correct; received from the provider, never sent anywhere |
| AI glosses: French glosses of a dictionary entry, with their provenance (#188) | No | In the backup file; « Delete » removes them and allows a new request |
| Voice recordings and pitch curves | Yes (voice) | The microphone opens only when the learner presses Record and closes when the recording ends, the page is hidden or left (#116). Samples and pitch curves stay in memory for the score, then are dropped, unless the learner presses Keep: one recording per word reading is then stored (16 kHz, 16-bit samples), replacing the one kept before, listed with its size in Profile > Data and deletable one by one or all (#118). Kept recordings are not in the backup file and are never uploaded. The voice is never processed to identify anyone, so it is not biometric data (“which allow or confirm the unique identification”, GDPR art. 4(14)). Speech recognition (#119) transcribes the recording in a worker on the device; the samples and the transcript are dropped with the next recording |
| AI settings: provider, local server address, model, the structured-output mode that worked per model, whether the AI notice was seen (#181, #207) | No | Consent-exempt storage (Loi Informatique et Libertés art. 82, see [AI features](ai.md#13-storing-the-key)) |
| AI key (#181) | Secret | In IndexedDB, or in memory only with « Don't remember the key »; sent only to its provider, in the `Authorization` header; never in the backup file, sync or any other request; « Forget the key » deletes it. Consent-exempt like the settings |
| Preferences (language, theme, tone colors, Anki field and card template choices per note type) | No | Consent-exempt UI personalization |
| Backup file (JSON, exported from Profile) | Yes (learning data) | Cards, review log, personal decks, settings, interests, challenges, journal entries, texts, « Je connais » marks, the personal lexicon and the answers kept from Wikidata and AI checks, AI corrections and AI glosses with their provenance; no dictionary data, never the AI key. Saved wherever the user chooses; OpenLinguo never receives it. Import merges by ids |

## On the OpenLinguo server (from M7)

In Cloudflare D1, created in the `eu` jurisdiction (ADR 0015).

| Data | Source | Who can see it |
|---|---|---|
| Account: email, pseudonym (empty until the learner sets one), the Google or GitHub account id, sessions (IP address, user agent, expiry), created and updated dates, role, ban status. No password; no name, picture or token from Google or GitHub (#270) | Sign-in | Maintainer (admin) |
| Sign-in codes: 6 digits, stored hashed, valid 10 minutes, 3 attempts | Asking for a code | Maintainer, as a hash only |
| Authenticator (optional, mandatory for the admin): TOTP secret and backup codes, encrypted with the server secret; the time a session passed it (#271) | Turning on TOTP | Maintainer, encrypted only |
| Age declaration: the date of « J'ai 15 ans ou plus », asked right after the first sign-in; « J'ai moins de 15 ans » deletes the account at once | Age step | Maintainer |
| Library submissions: title and plain text, origin (the learner's text, or a story with its AI provenance), licence fixed by the origin (CC BY-SA 4.0 or CC0 1.0), attribution (the pseudonym or anonymous), attestation version and time, status (#273); at approval, the HSK band estimated in the admin's browser and the publication time; for a rejection or removal, a statement of reasons (DSA art. 17(3): measure, own initiative, legal ground or terms clause, facts, explanation, no automated means) emailed to the submitter (#274) | « Soumettre à la bibliothèque » | Maintainer; published texts are public |
| Notices: the text reported, the reasons, the notifier's name and email (optional for child sexual abuse material), the good-faith statement, the time, the decision (#276) | « Signaler », with no account | Maintainer; the submitter gets the statement of reasons, never the notice |
| Hosting records (décret 2021-1362 arts 5 to 7): account id, submission id, operation (create, edit, delete), IP address, HTTP and TLS versions, time; the source port column stays empty because Cloudflare does not pass it | Each creation or withdrawal of a submission | Only the daily jobs and the admin export for an authority |
| Sealed identity (décret 2021-1362 arts 2 and 3): the email and the pseudonym of a deleted account that submitted (#277) | Account deletion | As hosting records |
| Erasure log: ids of what was erased and the time, applied again after a Time Travel restore (#277) | Account deletion | Daily jobs |
| Job runs: job, start, end, outcome; no personal data (#278) | Each daily job | Maintainer, through `/api/health` |
| Synced cards and review log (M8) | Sync | Maintainer (operations only) |
| League entries: pseudonym, predefined avatar id, weekly XP (M8) | Recomputed from synced review logs | Other league members see pseudonym, avatar and XP |
| Security events: sign-in, failed sign-in, code sent, authenticator code passed or failed, and admin actions with the account concerned, with the method or operation, the account id when known, IP address, user agent, failure code and time; no email address | Each sign-in, failure, code sent, authenticator check and admin action | Maintainer |
| Rate-limit counters: IP address and route, count, time of the last request | Each request to `/api/auth` | Maintainer (operations only) |
| Rights and support requests | Email | Maintainer |

## With third parties

| Party | What they receive | When |
|---|---|---|
| The learner's AI provider (BYOK, [AI features](ai.md)) | What the feature sends (table below), the learner's key, the model id, OpenLinguo's prompt, and the IP address and request metadata of the request | Only when the learner presses an AI button, after the notice naming the provider and the AI notice shown before the first call; nothing in the background |
| Wikimedia Foundation, U.S. ([Wikidata lookup](wikidata.md)) | The unknown character sequences of a text (names of people, places, organizations) in the web address of the request, the IP address, the browser's user agent and the app's `Api-User-Agent`; no cookie, no referrer. Request logs: deleted, aggregated or de-identified after at most 90 days, backups up to 5 years | Only when the learner presses « Chercher sur Wikidata », after the notice shown before the first call: one request per 50 sequences, one after the other; nothing in the background |
| Cloudflare, Inc. (processor: Pages, Pages Functions, D1 in the `eu` jurisdiction, cron Worker) | IP address and request metadata of every request; everything stored on the server, above | Always, as the host of the app and the API |
| Google Ireland, GitHub (OAuth, independent controllers) | Sign-in exchange; OpenLinguo keeps only the account id and the email | Only if the user chooses that sign-in method |
| Lettermint (transactional email, Netherlands, processor) | Email address, the mail: the sign-in code, the statement of reasons of a rejection or removal (#274), the receipt and decision of a notice (#276), the inactivity notice (#278). No open or click tracking. Content, address and metadata kept 28 days; delivery events at most 90 days | When the learner asks for a code, and for each of those emails |
| Competent authorities | Hosting records and sealed identity, on a written requisition (#290); a report of a serious offence (LCEN art. 6 IV.A, DSA art. 18) | Only on request or when a report is due ([moderation runbook](moderation.md)) |

What each AI feature sends, shown under its button as « Sent: … » (ADR 0012):

| Feature | Sent |
|---|---|
| « Test the connection » (#181) | A model list request, then a short fixed prompt with no learner data |
| « Correct » on a challenge (#184) | The word, the 5 sentences, the interface language |
| « Correct » on a journal entry (#185) | The entry, the interface language |
| « Suggest words » (#187) | The themes ticked, the short field, the learner's level, the number of words wanted |
| « Translate to French » (#188) | The headword, its pinyin and English glosses |
| « Demander à l'IA » in the unknown-words panel (#231) | The unknown character sequences and, for each, the sentence of the text it comes from, the interface language. Not the rest of the text or its title |
| « Écrire une histoire » (#232) | The learner's level (band), the theme, the length, and up to 20 words from their learning steps. No text of theirs |

« Chercher sur Wikidata » (#230) shows its own « Envoyé : … » line under the button: the sequences, the IP address and the browser go to the Wikimedia Foundation, never the sentence, the text or its title.

No analytics, no ads, no third-party fonts or scripts at runtime.

## Data portability

The backup export gives the learner their cards, review log and decks "in a structured, commonly used and machine-readable format" (GDPR art. 20(1), [EUR-Lex 32016R0679](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679)). Art. 20 binds a controller only for data it processes; from M8 the same export covers synced data.
