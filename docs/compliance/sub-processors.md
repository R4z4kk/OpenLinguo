# Sub-processors and transfers

Checked on 2026-10-31 on each provider's own pages and on the [official Data Privacy Framework list](https://www.dataprivacyframework.gov/list), read through the participant records the list page loads. The statuses and agreements are dated values in `packages/core/src/compliance-facts.ts` (`DPF_STATUS`, `PROCESSOR_FACTS`): from each `reviewBy`, a unit test fails until the value is read again on its source and this page updated. DPF participants re-certify every year; the EU adequacy decision for the DPF, [Decision (EU) 2023/1795](https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj), is in force: the General Court dismissed Latombe (T-553/23) on 2025-09-03, and the appeal C-703/25 P is pending on [Curia](https://curia.europa.eu/juris/liste.jsf?num=C-703/25) on 2026-10-31.

## Processors

| Provider | Role | Data | Location | Agreement | Transfer safeguard |
|---|---|---|---|---|---|
| Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA (Pages, Pages Functions, D1, Workers cron) | Processor: serves the PWA, runs the API and the daily jobs, stores the database | IP address and request metadata of every request; everything in D1: accounts, sessions, submissions, decisions, notices, hosting records, security events | D1 created with jurisdiction `eu`: databases "only run and store data within a region" ([data location](https://developers.cloudflare.com/d1/configuration/data-location/), updated 2026-10-02). The CDN and the Functions run in Cloudflare's global network | [Customer DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) version 6.4, effective 2026-04-03, which "forms part of the Main Agreement", the [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) included; breach notice "without undue delay" (§3.1(e)); its own sub-processors on [cloudflare.com/gdpr/subprocessors](https://www.cloudflare.com/gdpr/subprocessors/) | DPF: Cloudflare, Inc. active for the EU-U.S. DPF, the UK extension and the Swiss DPF, non-HR data covered, next certification due 2027-09-15. The DPA also applies the EU SCCs (§6.2(a)) |
| Scaleway SAS, 8 rue de la Ville-l'Évêque, 75008 Paris (Transactional Email, region `fr-par`) | Processor: service emails (sign-in codes, statements of reasons, notice receipts and decisions, inactivity notice) | Email address, message content; no tracking pixel, no link rewriting | "Email content, metadata, logs, webhook data, and backups are stored and processed in France" ([data privacy](https://www.scaleway.com/en/docs/transactional-email/reference-content/data-privacy/), 2026-10-19) | [Data Processing Agreement](https://www.scaleway.com/en/contracts/), version of 2024-06-01, which "forms an integral part of the contract" | None needed: no transfer outside the EU |

Retention at the processors: Cloudflare does not store Pages Functions logs ([logging](https://developers.cloudflare.com/pages/functions/debugging-and-logging/)); Scaleway deletes a mail's content once it is accepted, but keeps sending logs and metadata "for as long as your Transactional Email domain is active", and plans to shorten this in 2027.

## Independent controllers chosen by the learner

Not processors: the learner chooses Google or GitHub to sign in, and each acts under its own privacy policy. OpenLinguo receives the account id and the email, and drops the name, the picture and the provider tokens (#270).

| Provider | Controller for EEA users | Transfer |
|---|---|---|
| Google | "Google Ireland Limited for users of Google services based in the European Economic Area or Switzerland" ([privacy policy](https://policies.google.com/privacy), effective 2026-10-16) | None by OpenLinguo: the exchange is with an EU company. Google LLC, its U.S. parent, is active on the DPF list, due 2027-09-13 |
| GitHub | "GitHub, Inc. or GitHub B.V." ([privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), effective 2026-04-27); the statement does not say which one serves EEA users | Possibly to the U.S.: GitHub's own entry on the DPF list is active for non-HR data, due 2027-08-03; GitHub also relies on the SCCs |

## Not sub-processors

- **The learner's AI provider** (see below).
- **Wikidata** (see below).
- **GitHub (repository hosting)** holds source code, not user data.
- **The maintainer's mailbox** for rights and support requests: `[CONTACT_EMAIL]` (`CONTACT_EMAIL` in `compliance-facts.ts`), provider to be recorded with the address.

## AI providers chosen by the learner

Not sub-processors. The learner picks one, pastes their own key and is bound by that provider's terms. Requests go from the device to the provider, never through OpenLinguo, which receives nothing ([AI features](ai.md#12-gdpr-most-likely-not-a-controller-of-the-ai-calls)). The app offers the providers below and preselects none (ADR 0012). A cloud provider is added by pull request, updating this table and the CSP. Gemini is not offered: its [terms](https://ai.google.dev/gemini-api/terms) allow only paid services for apps serving users in the EEA.

| Provider | Endpoint | Training on requests, checked 2026-10-19 |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | Not permitted unless the customer allows it ([services agreement](https://console.groq.com/docs/legal/services-agreement) §4.2) |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenRouter stores no request unless the user opts in; the providers behind some models may keep or train on them ([data collection](https://openrouter.ai/docs/guides/privacy/data-collection)) |
| Mistral | `https://api.mistral.ai/v1` | The free mode may train on inputs and outputs until the user opts out ([Mistral help](https://help.mistral.ai/en/articles/347617)) |
| A local server (Ollama or any OpenAI-compatible server) | `http://localhost` or `http://127.0.0.1`, any port; Ollama's `11434` by default | None: the data stays on the device |

## Wikidata, queried by the learner

Not a sub-processor. When the learner presses « Chercher sur Wikidata » (#230), after a notice, the browser sends the unknown character sequences of their text to the Wikidata query service, never through OpenLinguo, which receives nothing. The destination is fixed by the app, not chosen by the learner, which makes the role analysis less firm than for AI: see [Wikidata lookup](wikidata.md#2-roles-most-likely-not-a-controller).

| Service | Operator | Endpoint | Data sent | Location | Retention, checked 2026-10-21 |
|---|---|---|---|---|---|
| Wikidata Query Service | Wikimedia Foundation, Inc. | `https://query.wikidata.org/sparql` | The sequences (in the address), IP address, browser's user agent | U.S. | IP address and user agent deleted, aggregated or de-identified after at most 90 days; backups up to 5 years ([retention guidelines](https://foundation.wikimedia.org/wiki/Policy:Data_retention_guidelines)) |

The Foundation's [privacy policy](https://foundation.wikimedia.org/wiki/Policy:Privacy_policy) names no transfer mechanism; its Data Privacy Framework status is to be checked on the official list (see [Wikidata lookup](wikidata.md#3-the-transfer-to-the-us)).
