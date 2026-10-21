# AI models tested

The learner picks a model from their provider's list ([ADR 0012](adr/0012-ai-mobilization-byok.md)). The only id in the code is `openai/gpt-oss-20b`, recommended in Groq's list until its review date (`RECOMMENDED_MODEL`, checked 2026-10-20, review by 2027-01-20). This page lists the models it was tested with, how and when. Free models come and go: a model below may have left its provider's list since.

## Recorded responses

Real answers, replayed without a key by the unit tests (`packages/core/src/testing/ai-responses/`) and the E2E (`apps/web/e2e/fixtures/ai/`). Recorded with `pnpm --filter @openlinguo/core record:ai` and `pnpm --filter @openlinguo/web record:ai`.

| Provider | Model | Recorded | Covers |
| --- | --- | --- | --- |
| Groq | `openai/gpt-oss-20b` | 2026-10-19 | model list, structured answer, reasoning off, schema violation, wrong key, rate limit, unknown model; interests vocabulary and French gloss in the app |
| Groq | `openai/gpt-oss-20b` | 2026-10-21 | `zh-explain-v1` (#231) and `zh-story-v1` (#232), not replayed yet. The story's strict `json_schema` request got a 400 (`json_validate_failed`, empty `failed_generation`) and the answer came through `json_object`; one run, not known to repeat |
| Ollama 0.35.1 (local) | `qwen3:30b-a3b` | 2026-10-19 | model list, structured answer, reasoning off, schema violation, unknown model |
| Ollama 0.35.1 (local) | `qwen3:30b-a3b` | 2026-10-20 | with `zh-correct-v2` (#206): connection test, challenge and journal corrections, card from a sentence in the app |
| Ollama 0.40.7 (local) | `qwen3:30b-a3b` | 2026-10-21 | `zh-explain-v1` and `zh-story-v1`, not replayed yet. Right kinds, generic meanings ("a person's name"); the medium story came back at 110 characters in 11 one-sentence paragraphs, against about 400 asked |
| OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free` | 2026-10-19 | model list, structured answer, schema violation, wrong key, unknown model (a 400) |
| OpenRouter | `dots-studio/dots-3-note-preview:free` | 2026-10-20 | model list filtered to structured answers, connection test, challenge correction with the sentences out of order (3, 1, 2, 4, 5); recorded with `zh-correct-v1`, the E2E adds each answer's index (#206) |
| Mistral | `mistral-small-latest` | 2026-10-19 | wrong key only: the API needs a paid plan |

On 2026-10-20 the free endpoint of `nvidia/nemotron-3-super-120b-a12b:free` was down (OpenRouter's 30-minute uptime at 0, a 404 « Provider returned error »), so the app recordings of that day use another free model.

Tested on documented shapes rather than recordings, as they cannot be triggered on demand: OpenRouter's rate limit, OpenRouter's error inside a 200 ([errors](https://openrouter.ai/docs/api/reference/errors-and-debugging)), a 200 whose content is not JSON.

## Manual runs

With the maintainer's own keys, in the browsers named.

| Date | Provider | Model | Browsers | Result |
| --- | --- | --- | --- | --- |
| 2026-10-20 | Groq | `openai/gpt-oss-20b` | Brave (Chromium) | Works: challenge corrected, card made from a sentence, 一路平安 translated, words suggested, journal corrected |
| 2026-10-20 | Groq | `openai/gpt-oss-20b` | Firefox | Works: journal corrected |
| 2026-10-20 | Ollama (local) | `qwen3:30b-a3b` | Brave (Chromium), Firefox | Works: journal corrected. Weak corrections: an entry without its final full stop is flagged with many errors, the same entry with it with none |
| 2026-10-20 | OpenRouter | — | — | Not run: the maintainer's free quota was used up by the recording runs of that day. Covered by the recorded E2E |
| 2026-10-20 | Mistral | — | — | Not run: the API needs a paid plan |

The run found that the provider could not be changed with the mouse (fixed in #205).
