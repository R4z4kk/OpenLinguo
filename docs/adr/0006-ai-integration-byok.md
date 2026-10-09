# 0006 — AI integration (bring your own key)

- Status: Accepted
- Date: 2026-10-09

## Context

Correction, sentence checks, personal vocabulary and story generation need an LLM. The project has no budget and must not hold user data or provider keys.

## Decision

- Users configure any OpenAI-compatible endpoint and key (e.g. Groq, OpenRouter, Ollama). The key stays in IndexedDB and never reaches the project API.
- Calls go directly from the device to the provider, after a notice naming the configured endpoint.
- Structured output (JSON schema where supported), validated with zod; retries with backoff on 429; CORS, auth and timeout errors are shown explicitly.
- Every AI output is a proposal the user validates before it becomes a card or a library submission. Proposed words are filtered against the dictionary.
- Every AI output is labeled in the UI and stored with machine-readable provenance (`origin: "ai"`, provider, model), per AI Act art. 50(1) and 50(2).
- Prompts are versioned per language pack.

## Consequences

- Zero AI cost for the project; quality depends on the user's model.
- CSP `connect-src` must allow user-configured endpoints.
