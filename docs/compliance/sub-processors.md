# Sub-processors and transfers

None of these is used before M7. Before each goes live, verify its status on the official Data Privacy Framework list at [dataprivacyframework.gov](https://www.dataprivacyframework.gov/) (participants re-certify every year) and sign or accept its data processing agreement. If a US provider is not active on the list, rely on the Standard Contractual Clauses in its agreement.

| Provider | Role | Data | Location | Transfer safeguard | Status |
|---|---|---|---|---|---|
| Cloudflare, Inc. (Pages) | Processor — serves the PWA | IP address, request metadata | Global CDN, US company | DPF (reported active, secondary sources) or SCCs | Verify in M7 |
| Google LLC (OAuth) | Independent controller for its sign-in | Sign-in exchange, only if chosen by the user | US | DPF (reported active, secondary sources) | Verify in M7 |
| GitHub, Inc. (OAuth) | Independent controller for its sign-in | Sign-in exchange, only if chosen by the user | US | Own DPF certification (Microsoft list, last updated 2024-09) | Verify in M7 |
| SMTP provider `[TBD]` | Processor — service emails | Email address, message content | `[TBD]` | `[TBD]` | Choose in M7, prefer EU hosting |

Not sub-processors:

- **The self-hosted API and database server** is operated by the controller itself.
- **The learner's AI provider** (see below).
- **GitHub (repository hosting)** holds source code, not user data.

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
