# 0003 — LanguagePack with capabilities

- Status: Accepted
- Date: 2026-10-09; English pack dropped 2026-11-03 (see the amendment)

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

## Amendment (2026-11-03): Mandarin only

The maintainer dropped English as a language to learn: M9 will not be built, and the project focuses on Mandarin. English stays as an interface language and for glosses.

- `LanguagePack`, the module registry and the contract tests stay, so another language can be added as a package.
- `lang-en` stays as the minimal fixture of those tests, with no content planned.
- The abstraction is now checked by that fixture, not by a second real language, so it may still hold Mandarin assumptions. `apps/web` calls `lang-zh` directly: a new language would have to wire its pack through the app as well.
