# 0014 — Graded reader

- Status: Accepted
- Date: 2026-10-20 (#34)

## Context

M6 (#34) adds a reader for Chinese text: segmentation, a word sheet on tap, add to SRS, known-word highlighting and a coverage percentage, user import (paste, `.txt`), the unknown-word resolution cascade decided on 2026-10-09, and AI stories with a coverage check and their proper names, moved from M5 (ADR 0012). Exit criteria: an imported text shows its coverage, and the word sheet works offline. The roadmap targets 98 % known-word coverage (Hu & Nation 2000), configurable.

What exists on develop (648e693):

- `createSegmenter(lexicon)` in `lang-zh`: bidirectional maximum matching over the CC-CEDICT headwords, fixed when the pack is created. A Han character outside the lexicon comes out as a one-character token; punctuation has `isWord: false`.
- `applySandhi(words)` needs one reading per word. `readText` (`apps/web/src/data/transcript.ts`) shows the first entry's reading; nothing turns a text into pinyin.
- The extended lexicon (#52, Chinese Wiktionary, 61,459 words) and the name tags (#53, jieba, 89,004 words) import on demand and are not used yet.
- `searchDictionary`, the word page's `fileWord`, the AI client and the `PromptPack` (`zh-correct-v2`, `zh-vocabulary-v1`, `zh-gloss-fr-v1`).
- No notion of a known word or of coverage, no store for texts. Dexie is at version 22.

## Findings (2026-10-20)

The full notes, with a URL and a quote for each point, were kept outside the repo.

### Wikidata

- One SPARQL `GET` on `https://query.wikidata.org/sparql` matches several strings exactly against labels and aliases (`VALUES` in `@zh` and `@zh-hans`, labels being split across zh, zh-hans and zh-cn) and returns `P31`, `P625` and the French and English descriptions in the same answer: 0.58 s for three strings. `wbsearchentities` takes one string per call and matches by prefix (张家界 also found Wulingyuan through an alias); `wbgetentities` needs ids.
- Tested: 周杰伦 → Q238819, `P31` = Q5, « chanteur et acteur taïwanais »; 张家界 → Q197379 through an alias, with coordinates; 王小红 → nothing. Homonyms return several items. About 81 % of Chinese people and places in China have a French description, 99 % an English one.
- Both endpoints answer `Access-Control-Allow-Origin: *` and accept the `Api-User-Agent` header, which the [Wikimedia User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) asks browser apps to send. [Query service limits](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual): 60 s per query, 60 s of processing per minute per client, 5 parallel queries per IP, 429 with `Retry-After` beyond.
- The query service moves from Blazegraph to QLever (`query-next.wikidata.org`); both run « until at least February 2027 », and the old one « may experience service degradation beginning February 2027 » ([WDQS backend update](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/WDQS_backend_update), edited 2026-10-17). The query avoids `wikibase:label`, which QLever drops.
- Structured data is CC0, with no attribution required ([Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)).
- The [Wikimedia privacy policy](https://foundation.wikimedia.org/wiki/Policy:Privacy_policy) (in force 2025-10-06) covers its APIs: the IP address is recorded, the user agent is personal information, servers are in the U.S., and the [retention guidelines](https://foundation.wikimedia.org/wiki/Policy:Data_retention_guidelines) delete, aggregate or de-identify IP and user agent after at most 90 days. The sequence travels in the URL, so it is in the request logs.

### AI Act art. 50(2) and generated stories (not legal advice)

- Art. 50(2) ([consolidated text of 27.07.2026](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727)) requires machine-readable marking, with solutions effective, robust and reliable « as far as this is technically feasible ».
- [Code of practice](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content), sub-measure 1.1.2: « For free-form text longer than 200 tokens, watermarking still needs to be applied ». A watermark is imperceptible and robust, and « not auxiliary metadata »; free-form text « cannot transport metadata », so for text the single layer is the watermark (measure 1.1). Logging alone is not sufficient (1.1.3). The tokenizer behind the 200 tokens is not stated, and the threshold is expected to decrease.
- [Guidelines C(2026) 5054](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems): a system provider may rely on the upstream model provider's marking « to the extent that the marking solution is compliant » (para 74). Technically feasible means implementable « using currently available technology … within the specific technical architecture and operational environment concerned », and the provider « is not obliged to make use of a technical solution that is not yet developed or available on the market, or that is technically unfeasible » (para 81).
- The study behind the code ([Puccetti, January 2026](https://op.europa.eu/en/publication-detail/-/publication/6c981119-4829-11f1-8095-01aa75ed71a1/language-en)) notes that a likelihood watermark « cannot be added to already generated text », and that zero-width marks are « easily removed ». The code's robustness tests include character insertion and deletion. Invisible characters would also break segmentation, coverage, speech, cards and search, and add line-break opportunities inside words (UAX #14).
- Mistral signed Section 1 of the code; whether its API output carries a watermark was not found. Groq and OpenRouter are not among the named signatories.

### Accessibility (WCAG 2.2, WAI-ARIA APG, HTML)

- A composite widget should be one tab stop (APG keyboard interface). A grid puts screen readers in application mode, where only focusable elements are read; a toolbar groups controls, not prose.
- A non-modal `dialog` gets no Escape by default and `closedby` is not in Safari; a modal dialog always passes 2.4.11 (Understanding 2.4.11). Content behind a modal is inert, so a status message about an action in the sheet lives inside the sheet.
- Target size 2.5.8 exempts targets « in a sentence or [whose] size is otherwise constrained by the line-height of non-target text ».
- `rt` has no accessible object on Windows and Linux accessibility APIs (HTML-AAM); a third-party test found ruby read in Firefox and iOS VoiceOver, not in Chrome, Edge or desktop Safari. The pinyin must also be in the word sheet as text.

## Decision

All choices below are the maintainer's, 2026-10-20.

- **Architecture**: pure functions in `packages/core` and `packages/lang-zh`, views in `apps/web`. A new nullable capability, `features.textReading` (ADR 0003), turns a text into annotated tokens: the word, its candidate readings ordered by level then frequency, whether it has several, and the pinyin after `applySandhi` (third tone grouped by words, 一 and 不). `lang-en` leaves it `null`. Core computes known words and coverage, so the M7 server can estimate a level with the same code.
- **Known word**: the reading of an occurrence (the one chosen, else the first) has a card in the `review` or `relearning` phase, or a « Je connais » mark. A card still in its learning steps is « en cours », not known.
- **« Je connais »**: in the word sheet, a word known outside the app counts as known with no card and no XP. It can be undone (« Je ne connais plus ») and is in the backup.
- **Coverage**: known Han word tokens over Han word tokens, counted per occurrence (running words). A validated proper name counts as known; punctuation, Latin letters and digits are left out. The reader also shows the number of distinct unknown words. The 98 % target is a Profile setting.
- **Polyphones**: the reading ordered first is shown with a mark; the word sheet lists every reading, and choosing one fixes it for that occurrence and removes the mark. No reading is chosen silently.
- **Pinyin above the characters** (`<ruby>`): a three-way control, none, unknown words or all, remembered, « unknown words » by default. The word sheet always has the pinyin.
- **Library and import** (Read tab): the learner's texts, the latest first, each with its title, date, coverage, unknown-word count and the AI badge for a story. « Coller un texte » (text area, optional title, else the first characters) and « Importer un .txt »: a UTF-8 or UTF-16 byte-order mark is followed, else strict UTF-8; text that is not valid UTF-8 is decoded as GB18030 and the encoding is shown, never guessed silently; anything else is an error. Texts are limited to 20,000 characters, a value the reader benchmark confirmed (see the update below). A text mostly in traditional-only characters gets a warning (simplified only in v1), with no conversion. A text can be deleted, with confirmation, not edited.
- **Reader**: one `<p lang="zh-Hans">` per paragraph, one native `button` per dictionary word, punctuation as text. A roving tabindex makes the passage one tab stop: ← and → move from word to word, Home and End go to the ends, and focus comes back to the last word visited; a visible hint says so. The container has no widget role, so screen readers keep reading the text in browse mode. Unknown words have a 2 px dotted underline in the text color, the tapped word an outline distinct from the focus ring, polyphones a mark with 3:1 contrast; the states are also given by `aria-describedby` (« mot nouveau », « plusieurs lectures ») and a legend.
- **Word sheet**: the existing modal `Dialog` (`showModal()`), as a bottom sheet with a dimmed backdrop and a visible close button. The word is focused before it opens (Safari does not focus a clicked button) and the sheet's heading takes focus; on close, focus returns to the word, which stays visible above the sheet. It shows the characters, the pinyin as text, the glosses (offline, through the pack's `lookup`), the readings of a polyphone, « Ajouter à mes mots » (`fileWord`, with the deck picker), « Je connais » and a link to the word page. After an action, a `role="status"` line inside the sheet gives the new coverage. Its buttons keep 44 px; words in the text use the 2.5.8 inline exception, recorded in the design system.
- **Dictionary sentence split** (#213): a sentence with no exact entry is listed word by word above the prefix matches; a word with several readings shows the first one and « N autres lectures », a link to its page.
- **Unknown sequences**: a character outside the dictionary, or a run of one-character segments (王|小|红). A run made only of HSK 1–3 words and absent from the extended lexicon is not sent to Wikidata (usually compositional, as 他|也|是); the AI can still be asked.
- **Local steps**, automatic and offline: the personal lexicon (already validated, applied), the dated resolution cache, the extended lexicon (#52), the name signal (#53). The last two give proposals only. The extended lexicon downloads on first use, its size shown, like the audio packs.
- **« Mots inconnus de ce texte »**: each sequence with its sentence and its proposals, each naming its source; the learner accepts, edits or rejects. An accepted sequence goes to the personal lexicon, the segmenter is rebuilt with it and the text is segmented again. Nothing is applied without the learner's validation.
- **« Chercher sur Wikidata »**: one click per text, one SPARQL `GET` per 50 sequences, sent one after the other, with `Api-User-Agent` and `referrerPolicy: "no-referrer"`. Type: person (`P31` = Q5), place (`P625`), organization (a short list of `P31` classes, Q43229 and the like); homonyms are listed for the learner to choose. A notice before the first call says that the sequence, the IP address and the browser go to the Wikimedia Foundation in the U.S., kept 90 days at most, and a « Envoyé : … » line sits under the button. The CSP adds `https://query.wikidata.org`; the data map and the records of processing name the transfer. The endpoint is a dated value: its review date, 2027-01-15, comes before the old service may degrade, and a CI test fails on that date until it is checked again.
- **« Demander à l'IA »**: when a provider is set, one batched call for the sequences still unknown: sequence and sentence in; type (person, place, organization, word, not a word) and meaning out. Prompt `zh-explain-v1`, provenance and badge as in M5. Each answer is a type and a short meaning, single words and very short text outside the code's watermark (guidelines para 68, code glossary).
- **Stories** (« Écrire une histoire », Read tab, with a provider): the learner's band (`learningBand`, as the M5 suggestions), a theme from the M5 interests (`THEMES`), a length, short (about 150 characters) or medium (about 400), and up to 20 words in their learning steps, the latest first, to use again. Prompt `zh-story-v1` returns `{ title, paragraphs, names: [{ text, kind }] }` in simplified characters. The answer is validated; an invalid one is an error with « Réessayer » and nothing is stored. A story is a text with `source: "ai"` and its provenance; its coverage is computed on the device, and its names come as proposals in the unknown-words panel. Another story is another click: nothing is retried or sent in the background.
- **Marking of stories (art. 50(2))**: the « Généré par IA » badge, the provenance field and the export metadata, with no watermark. The gap analysis in `docs/compliance/ai.md` records sub-measure 1.1.2 as not technically feasible for an app that cannot touch the model's sampling (para 81), and follows each provider's upstream watermark (para 74). Three values are dated: the 200-token threshold, the code's version (10.6.2026) and the watermark status of Groq, OpenRouter and Mistral. Their review date is 2027-04-20; a CI test fails on that date until they are checked again. Mistral's status is reviewed on 2026-12-03, the day after the date it announced marking for (#233).
- **Storage**: Dexie version 23 adds `texts` (`{ id, title, body, source, createdAt, provenance, readingChoices }`, the chosen readings keyed by token offset) and `knownMarks` (`{ headword, readingKey, markedAt }`). The cascade adds `lexicon` (`{ headword, kind, reading, gloss, source, provenance, validatedAt }`) and `resolutions` (`{ sequence, source, found, checkedAt }`, positive and negative, the date shown, a new check one click away) in the next free version. All four are in the backup, the cache so that a sequence already checked is never sent again; older backups import with them empty.
- **Mockups first** (ADR 0008): library, reader, word sheet, unknown-words panel and story form, on the design canvas's M6 page, approved before their UI code.
- **Verification**: unit tests for `textReading`, known words and coverage; a benchmark segmenting and annotating 20,000 characters in Chromium and WebKit, with a Web Worker only if it is too slow; E2E on Chromium and WebKit with axe; Wikidata and AI answers recorded and replayed without keys (Groq's recommended model and Ollama; OpenRouter when its free quota allows).

## Consequences

- M7 can compute coverage and estimate a text's level on the server with the same core functions.
- Every word of a text is a button, so screen readers say « bouton » for each one; the NVDA and VoiceOver pass of ADR 0008 checks that reading stays usable.
- Pinyin above the characters is not read by Chrome, Edge or desktop Safari screen readers; the word sheet carries it.
- Wikidata is a second destination outside the AI providers: one more notice, one more CSP host, one more line in the records of processing, and a backend change to follow before February 2027.
- Stories carry no watermark. This is a documented gap against the code of practice, not a signature; an authority may read « technically feasible » more strictly and ask for models that mark their output. The dated values make the maintainer look again every six months.
- Dexie goes to version 23 and the next free one is taken by the cascade.

## Update (2026-10-22, #227)

The reader's benchmark (`apps/web/e2e/reader-benchmark.e2e.ts`, Chromium and WebKit) opens texts of 9,770 words. The median of three runs, from the start of the page to the last word on screen, with the pinyin on unknown words (the default):

| Characters | Chromium (Windows) | WebKit (Linux, Docker, headless) | WebKit, every word distinct | WebKit on the GitHub runner (CI) |
|---|---|---|---|---|
| 20,000 | 0.9 s | 6.0 s | 18.9 s | 16.9 s (every word distinct: 30.3 s) |
| 10,000 | | 3.4 s | 6.7 s | |
| 5,000 | | 1.1 s | 2.1 s | |

(5,000 characters: one run, before the lookups were bounded.) A typical text repeats each word about three times; the last column is the most lookups a text of that size can cause. Where the time goes at 20,000 characters in WebKit: 1.8 s of dictionary lookups, 4 s of rendering with the pinyin (0.2 s without it), 30 ms for the known words and the pinyin. Segmenting 20,000 characters takes about 0.13 s (V8).

- **No Web Worker**: the CPU work that could move is under 0.2 s. The time is spent in IndexedDB, which is as slow in a worker, and in rendering, which cannot leave the main thread. What helped instead: one read transaction for all the lookups of a text, at most 100 lookups in flight (thousands queued together made each lookup slower in WebKit), `content-visibility: auto` on paragraphs, and fewer elements per word.
- **Import limit**: 20,000 characters confirmed (maintainer, 2026-10-22), after the CI runner (two vCPUs, software rendering, about 2.8 times slower than the Docker run) took 16.9 s for a typical text. The reader shows a status line while it splits the text, and arrow keys take 16 ms once it is drawn.
