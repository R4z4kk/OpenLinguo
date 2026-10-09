# 0003 — LanguagePack with capabilities

- Status: Accepted
- Date: 2026-10-09

## Context

Mandarin is first, other languages follow. An abstraction designed against a single language tends to encode its assumptions; Mandarin and English sit at opposite extremes (logographic and tonal vs alphabetic).

## Decision

- Each language is a package implementing `LanguagePack`: id, proficiency framework, `tokenize`, `lookup`, prompts, and a `features` object where each capability (`tones`, `strokes`, `romanization`, `decomposition`, `ime`, `phonetics`) is either an implementation or `null`.
- Modules declare the features they need; the registry hides modules the active language cannot support.
- `lang-zh` is fully implemented in v1; `lang-en` covers the generic modules (dictionary, SRS, reader, AI, shadowing, STT) in M9.
- A shared contract test suite runs against every pack, starting in M1 with a minimal `lang-en` fixture.

## Consequences

- The abstraction is validated by two real, very different languages.
- No lowest-common-denominator UI: language-specific modules stay rich.
