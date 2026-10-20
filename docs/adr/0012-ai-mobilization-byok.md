# 0012 — AI mobilization (BYOK)

- Status: Accepted
- Date: 2026-10-19; one AI notice and Groq recommended amended 2026-10-20 (#207)
- Amends [ADR 0006](0006-ai-integration-byok.md): presets and local servers instead of any endpoint

## Context

M5 makes the learner produce Chinese with help from an AI model, through their own provider and key (ADR 0006): a 5-sentence challenge, a daily journal, corrections shown as a diff, corrected sentences proposed as cards, personal vocabulary from an interests profile, and a French translation of dictionary entries that only have English glosses (decided 2026-10-09 in #55: on demand, never in batch). Exit criteria: works against Groq, OpenRouter and Ollama; invalid responses are rejected with a visible error.

The page's CSP allows `connect-src 'self'` only, so no provider can be reached today. Facts below were checked on 2026-10-19; the full notes, with a URL and a quote for each point, were kept outside the repo.

## Options and tests (2026-10-19)

### Providers

Keyless checks from our origin (`curl` preflight with `Origin: https://openlinguo.razakk.fr`, then requests without a key or with a wrong one), and the providers' own documentation:

| | Groq | OpenRouter | Mistral | Ollama (local) | Gemini (OpenAI-compatible) |
|---|---|---|---|---|---|
| Base URL | `https://api.groq.com/openai/v1` | `https://openrouter.ai/api/v1` | `https://api.mistral.ai/v1` | `http://localhost:11434/v1` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Preflight from our origin | 204, `*` | 204, `*` | 200, `*` | 403 unless `OLLAMA_ORIGINS` lists it | 200, origin echoed |
| CORS headers on a wrong-key error | yes (401) | yes (401) | yes (401) | no key | yes (400) |
| Unknown path | 404, CORS | 404, CORS | 404 without CORS: unreadable | 404 | 404 without CORS: unreadable |
| Extra request header | echoed | fixed list | fixed list | fixed list | preflight 403 |
| Error body | `{error:{message,type,code}}` | `{error:{code:number,message,metadata}}`, also inside an HTTP 200 | `{detail}` observed, `{object:"error",…}` documented | `{error:{message,type,param,code}}` | `[{error:{code,message,status}}]` |
| Strict `json_schema` | 4 models ([docs](https://console.groq.com/docs/structured-outputs)), others `json_object` | per endpoint, `provider.require_parameters` ([docs](https://openrouter.ai/docs/guides/features/structured-outputs)) | every model but `codestral-mamba` ([docs](https://docs.mistral.ai/studio/conversations/structured-output/custom)) | grammar from the schema, `strict` ignored (source v0.40.6) | accepted, strictness undocumented |
| Free use | 30 requests/min, 1,000/day on the free plan ([docs](https://console.groq.com/docs/rate-limits)) | `:free` models 20/min, 50/day ([docs](https://openrouter.ai/docs/api/reference/limits)) | free mode, limits shown in the console | own hardware | free tier |
| Training on prompts | no, by contract ([agreement](https://console.groq.com/docs/legal/services-agreement) §4.2) | OpenRouter no; upstream providers vary, `provider.data_collection: "deny"` | free mode yes until the user opts out ([help](https://help.mistral.ai/en/articles/347617)) | none | free tier yes |
| Where | data retained in the US | US | EU by default | the device | — |

- Re-checked on 2026-10-20 (#207): Groq's free plan still allows `openai/gpt-oss-20b` 30 requests/min and 1,000/day (« Free Plan Limits » tab of the [rate limits](https://console.groq.com/docs/rate-limits)). OpenRouter's `:free` models allow 20/min, and 50/day to an account that bought fewer than 10 credits, 1,000/day from 10 ([limits](https://openrouter.ai/docs/api/reference/limits)).
- `Retry-After` and `x-ratelimit-*` are not in any provider's `Access-Control-Expose-Headers`: a browser cannot read them.
- Gemini's [terms](https://ai.google.dev/gemini-api/terms): "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."
- Ollama from an HTTPS page: Chrome 142+ asks the user for local network access ([Chrome](https://developer.chrome.com/blog/local-network-access)), Firefox allows `localhost` and asks from 151 ([release notes](https://www.firefox.com/en-US/firefox/151.0/releasenotes/)), Safari blocks it as mixed content ([WebKit bug 171934](https://bugs.webkit.org/show_bug.cgi?id=171934), open). `OLLAMA_ORIGINS=https://openlinguo.razakk.fr` is required in every browser.
- No free Qwen, DeepSeek, Kimi or GLM model with structured output on OpenRouter on 2026-10-19; requiring zero data retention leaves one free model.

### Client

Three clients made the same structured call, against a mock server and against Ollama 0.35.1 on the GPU (`qwen3:30b-a3b`, `gemma3:4b`, 5 runs each): all 5/5. Versions published at least 7 days earlier.

| | In-house `fetch` + zod (184 lines) | `openai` 7.32.0 | `ai` 7.0.137 + `@ai-sdk/openai-compatible` 3.0.67 |
|---|---|---|---|
| Minified / gzip, zod excluded | 4.1 / 2.0 KB | 421 / 97 KB | 266 / 69 KB (68 KB of unused `@ai-sdk/gateway`) |
| Packages besides zod | 0 | 1 | 11 |
| `json_schema` refused with a 400 | falls back to `json_object` with the schema in the prompt | caught by hand; `json_object` 0/3 when the prompt does not name the keys | second provider by hand; `json_object` sent without the schema, 0/3 |
| 429, `Retry-After: 2` | waits 2 s | waits 2 s | waits 2 s |
| 5 s timeout, no answer | 5.0 s, `timeout` | 16.4 s: the timeout is per attempt | 5.0 s, a bare `DOMException` that hides a 500 seen before |
| Errors | one `kind` field | classes; schema mismatch throws a raw `ZodError` | `APICallError`; `DOMException` or `TypeError` on network errors |
| OpenRouter error in a 200, Mistral `{detail}` | parsed per provider | not handled | not handled |

- `qwen3` thinks for 170 s unless `reasoning_effort: "none"` is sent (6 s then); `think: false` and `/no_think` do nothing on `/v1`.
- Both models followed the schema on Ollama. `qwen3:30b-a3b` wrote its explanations in Chinese despite a French instruction, and `gemma3:4b` often corrected wrongly: quality depends on the model, not the client.

### Law (primary sources, read 2026-10-19; not legal advice)

- **AI Act**, [consolidated text of 27.07.2026](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727). Regulation (EU) 2026/1744 replaced only art. 50(7); art. 50 applies from 2 August 2026, and the transition of art. 111(4) covers only systems placed on the market before that date. Art. 2(12) keeps open-source systems under art. 50. OpenLinguo supplies the interface and the prompts around the user's model (recital 97, art. 3(68)), so it is treated as the provider; its users act for themselves and are not deployers (art. 3(4), 2(10)).
- **Commission guidelines on art. 50**, [C(2026) 5054](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems), 20.7.2026: exempt from marking as standard editing, « Grammar correction and spellchecking, linguistic and minor stylistic polishing that do not change the substance, meaning, style or messaging of text, AI-generated translations of text » (examples after para 92); outside art. 50(2), « single words, image captions, alt-text, UI labels » (para 68) and recommenders that only select existing content (para 65). A one-time prompt and reply is an interaction under art. 50(1) (para 30); « A single, prominent notification before the first interaction of the AI system with a particular natural person is likely to suffice in most instances », with periodic reminders in riskier contexts such as children (para 40); for an interactive session, the information « should, at least, be provided once at the start » (para 143); suggested disclosure: « Prominent, plain-language labels or banners (e.g. "You are interacting with an AI system") », with persistent badges; for children, « child-friendly, age-appropriate, easy-to-understand ». A provider who does not sign the code of practice writes a gap analysis against it (para 148).
- **[Code of practice on transparency of AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content)**, final 10.6.2026, found adequate in July 2026: text longer than 200 tokens carries an imperceptible watermark; « very short text » does not.
- **GDPR roles**: the [CNIL recommendation on mobile applications](https://www.cnil.fr/sites/cnil/files/2025-04/recommandation-applications-mobiles-modifiee.pdf) (délibération 2025-024, covering PWAs) treats a publisher whose app processes data on the device, at the user's initiative, as a software supplier only. Data sent to a provider leaves that sealed environment, and [Fashion ID](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62017CJ0040) (C-40/17) made a site operator joint controller of a transmission it embedded for its own commercial purpose. With no purpose of its own, every call started by the user, an endpoint the user chose, no relay and no telemetry, OpenLinguo is most likely not a controller of these transmissions ([EDPB guidelines 07/2020](https://www.edpb.europa.eu/system/files/documents/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf); C-25/17 para 68). No authority has ruled on bring-your-own-key apps.
- **Storage of the key**: strictly necessary for a service the user explicitly asked for, so exempt from consent ([Loi Informatique et Libertés art. 82](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000037813978); CNIL délibération 2020-092 para 49 recommends mentioning it).
- **Security**: [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) on IndexedDB: « Avoid storing session tokens, credentials, or other secrets there. » A non-extractable WebCrypto key does not stop an injected script from using it, and every request carries the key in clear in its `Authorization` header.
- **Free text**: a journal or an interests profile can reveal health, religion or beliefs (GDPR art. 9; C-184/20 para 123). The CNIL's [generative AI Q&A](https://www.cnil.fr/fr/les-questions-reponses-de-la-cnil-sur-lutilisation-dun-systeme-dia-generative) advises avoiding personal data in prompts.

## Decision

All choices below are the maintainer's, 2026-10-19.

- **Scope**: AI story generation, its coverage check and its proper names, and the batched « explain unknown sequences » call move to M6, where the reader shows them (#34).
- **Client: in-house** in `packages/core`, `fetch` + zod, no dependency. A call returns `Result<T, AiError>`; `kind` is `network` (offline, CORS, wrong address), `auth`, `forbidden`, `model-not-found`, `rate-limited`, `quota`, `too-large`, `server`, `timeout` or `invalid-response`. Error bodies are parsed in the OpenAI, OpenRouter (including an error inside a 200) and Mistral shapes, with a fallback for any other. Only `Authorization` and `Content-Type` are sent.
- **Structured output**: `json_schema` strict first; if the endpoint refuses it with a 400, `json_object` with the schema in the prompt, remembered per model. Every response is validated by zod; an invalid one is shown as an error with a retry and nothing is stored. 429 and 5xx are retried twice, after 2 s then 8 s, as `Retry-After` cannot be read; one call lasts 60 s at most. Reasoning is turned off where the endpoint accepts it.
- **Endpoints**: presets Groq, OpenRouter (`require_parameters`, models filtered on `structured_outputs`) and Mistral, plus a local server on `localhost` or `127.0.0.1`, any port (Ollama's 11434 by default, with how to set `OLLAMA_ORIGINS`). CSP: `connect-src 'self' https://api.groq.com https://openrouter.ai https://api.mistral.ai http://localhost:* http://127.0.0.1:*`, checked by the security-headers test. A cloud provider is added by a pull request. Gemini is not offered (terms above). No provider is preselected; Groq carries a « Recommandé » badge, as its free plan allows the most requests a day (2026-10-20, #207).
- **Models**: picked from the endpoint's `GET /models`; none is picked for the learner. The docs list the models tested, with their date. One id is written in code, `RECOMMENDED_MODEL`: `openai/gpt-oss-20b` on Groq, tested by the maintainer, marked « recommandé » when Groq lists it. It is dated: three months after the check the app stops recommending it, and a CI test fails until it is tested again (2026-10-20, #207).
- **Settings** (Profile › AI): provider, key, model, « Test the connection » (model list, then a small structured call), « Forget the key ». The key is kept in IndexedDB unless « Don't remember the key » keeps it in memory only. It never enters the backup, sync or any request other than to its provider. The settings advise a dedicated key with a spending cap.
- **Prompts**: `PromptPack`, the `prompts` member of `LanguagePack` (ADR 0003), holds versioned prompts and their zod schemas: correction, vocabulary for interests, gloss translation. The correction prompt asks for minimal fixes that keep the meaning (the art. 50(2) editing exemption); a « rewrite in better style » mode is not offered. Explanations come in the interface language.
- **5-sentence challenge**: the last step of the Today session, skipped when no word was started that day. The learner writes 5 sentences with the most recent word started today, through the M4 input method or the system keyboard. They are kept on the device; « Correct » sends the word and the 5 sentences in one call. It can be skipped without penalty.
- **Journal** (Learn): one entry per learning day, corrected on demand.
- **Without a provider** the challenge and the journal still work; « Correct » appears once a provider is set, also for older entries. Neither earns XP, which stays a function of the review log; both are in the backup with their corrections and provenance.
- **Correction diff**: per sentence, the corrected text and each change with its explanation, the pinyin and the French meaning. Inserted characters underlined, removed ones struck through, never by color alone. « Accept » or « Keep mine » per sentence.
- **Corrected sentence → card**: a proposed note (recognition and recall cards) with the accepted sentence, the AI's pinyin and meaning, editable. Each pinyin syllable must be a CC-CEDICT reading of its character; a mismatch is flagged for the learner to fix, never replaced silently. The note is created in a personal deck the learner picks (« My words » by default) only when they confirm.
- **Personal vocabulary**: Profile › Interests, themes to tick and one short free field. « Suggest words » sends the themes, the field and the learner's level; the AI returns headwords, kept only if they are dictionary entries not yet started, shown with the dictionary's pinyin and glosses. The learner ticks words into a personal deck, which comes first in the new-card order.
- **Translate to French**: on a word page without a French gloss, one entry per call (headword, pinyin, English glosses). The French glosses are shown beside the English source, stored with their provenance so the entry is translated once; deleting them allows a new request.
- **Transparency (AI Act art. 50)**: before the first AI call of any kind, « Test the connection » included, one plain notice that a machine writes the answers and can be wrong, in words a teenager understands; it never shows again (2026-10-20, #207; one notice per feature before). Then a « Generated by AI · model » badge beside every AI output, and the « Sent: … » line under every AI button, keep the reminder next to each call (guidelines para 37). Every stored AI item carries `{ origin: "ai", provider, model, promptVersion, createdAt }`, never the learner's identity; the field is in the backup and specified in `docs/compliance/`, which also holds the per-feature exemption analysis and the gap analysis against the code of practice.
- **Notices**: on setup, the provider named, « nothing goes through OpenLinguo », its privacy policy and how to refuse training (Mistral's free mode trains by default). The AI notice lists what each AI button sends and warns against health, religion, politics or sex life, as the lines under the journal and the interests field do. Under each AI button, a line « Sent: … ». Every call is one click by the learner; nothing is sent in the background.
- **Rendering**: model output is text, never HTML.
- **Verification**: real responses recorded from each provider (success, schema violation, 401, 429, an error inside a 200, an unknown model) are replayed in E2E, without keys. At the M5 exit, a manual run with the maintainer's keys and a local Ollama is recorded in the pull request. No key is stored in GitHub.

## Consequences

- No new runtime dependency; the client and the error parsers are ours to maintain, and a provider that changes its error shape falls to the generic parser.
- ADR 0006's « any OpenAI-compatible endpoint » becomes three cloud presets plus any local server: the CSP keeps limiting where a script can send data. A provider outside the list needs a pull request or a local proxy run by the user.
- Safari users cannot use a local Ollama from the HTTPS app; they need a cloud preset.
- OpenRouter's free models with structured output are few and change often, and Mistral's free mode trains on prompts unless the learner opts out: the notices say so.
- `docs/compliance/` gains the art. 50 analysis, the provenance specification and the role analysis; the data map and the privacy notice name the AI settings, the key and what each feature sends.
- The M5 screens are mocked up and approved before their UI code (ADR 0008).
- Watermarking long generated text (M6 stories) remains open; M6 decides it with the gap analysis.
- The recommended model is the one value in the AI code that goes stale: its review date makes the maintainer test it again every three months, or the recommendation goes.
