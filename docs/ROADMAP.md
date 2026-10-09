# OpenLinguo — Roadmap

## Context

OpenLinguo is an open-source (AGPL-3.0) language-learning app. Mandarin first, English second (to validate the multi-language abstraction), more languages later.

Pedagogy combines two models:

- **Learning tripod (Izzy Sealey)**: prioritization (Pareto 80/20 via frequency lists + personal vocabulary), active memorization (SRS, morphological decomposition, comprehensible input), mobilization (5 sentences per new word, journaling, correction, shadowing).
- **Operational pillars (Brian Wiles)**: early tone and pinyin training, reading and writing (pinyin typing vs handwriting), listening with target-language-only subtitles from intermediate level.

Architecture decisions are recorded in [`docs/adr/`](adr/). Milestones and tasks are tracked as [GitHub milestones and issues](https://github.com/R4z4kk/OpenLinguo/milestones).

## Decisions (2026-10-09)

| Topic | Decision |
|---|---|
| Platform | Web PWA (React + Vite + TS) first, Capacitor wrapper post-v1. Flutter excluded (TS-only rule) |
| User data | Local-first (IndexedDB via Dexie), optional account; append-only review log enables sync later |
| v1 scope | Core (dictionary, HSK, decomposer, FSRS) + tones/pronunciation + writing + AI mobilization + graded reader + backend library + full gamification + `en` core. OCR post-v1 |
| UI / glosses | i18n FR + EN from day one. Glosses: EN (CC-CEDICT), FR (CFDICT if license verified) |
| HSK | HSK 3.0, two referentials: **2025 exam syllabus** (新版HSK考试大纲, CLEC, Nov 2025, `hsk-2025`, default) and the free **GF0025-2021** national standard (`gf0025-2021`), selectable |
| Script | Simplified only (traditional stored, toggle later) |
| AI | BYOK, OpenAI-compatible endpoint (Groq, OpenRouter, Ollama…). Every AI output is a proposal, human validates |
| Audio | Pre-generated neural TTS (static files) + F0 contours extracted offline |
| STT | Whisper in browser (transformers.js, Web Worker, model on demand) |
| Reader content | AI-generated + coverage check, user import, in-app "submit to global library" → admin moderation |
| Backend | Self-hosted TS API: Hono + Drizzle + Postgres + Better Auth (email/password + Google + GitHub) |
| Hosting | PWA on Cloudflare Pages at `openlinguo.razakk.fr` (custom domain, OVH CNAME), API at `openlinguo-api.razakk.fr` on a self-hosted Docker host behind Traefik, Postgres 16. Same registrable domain → first-party cookies |
| Multi-language | Capability-based LanguagePack; `lang-zh` full, `lang-en` core (generic modules only) |
| Gamification | Full: XP, levels, streaks, daily goal, achievements (local) + weekly leagues (server) |
| Team | Solo for v1, contributors after v1 → automated PR security gates + mandatory human review |
| License | AGPL-3.0 (code). Data keeps its own licenses (CC BY-SA, LGPL, Arphic…) |
| Visual direction | Calm editorial base (direction A) with discreet gamification |
| UI components | shadcn/ui + Radix primitives, Tailwind, token-based theming |
| Navigation | Guided "Today" session + free access tabs: Today / Learn / Read / Profile |
| Accessibility | WCAG 2.2 AA (EN 301 549 v4.1.1 baseline), published accessibility statement |
| Privacy | GDPR privacy-by-design, no analytics in v1 → no consent banner, accounts 15+ only |
| AI transparency | Every AI output labeled "AI-generated" + machine-readable provenance (AI Act art. 50) |

## Architecture

### Monorepo (pnpm workspaces)

```
apps/
  web/            React + Vite PWA (vite-plugin-pwa, TanStack Router, Tailwind, i18next, Dexie)
  api/            Hono + Drizzle + Postgres + Better Auth (Docker image → GHCR → homelab)
packages/
  core/           Result type, domain model, LanguagePack interface + contract tests,
                  FSRS wrapper (ts-fsrs), session composer, XP/achievement rules, shared zod schemas
  lang-zh/        pinyin, tones/sandhi, segmentation, decomposition, IME candidates, zh prompts
  lang-en/        tokenization, IPA, CEFR levels, en prompts
tools/
  data-pipeline/  TS scripts: download (pinned URL + sha256) → parse → build shards → manifest
data/
  manifest.json   source, license, version, retrievedAt, maxAgeDays, sha256 per dataset
docs/
  ROADMAP.md, adr/
```

`core` + lang packs run both in the browser and in the API (server-side level estimation of submitted texts reuses the same code).

### LanguagePack (capabilities = nullable features)

```ts
interface LanguagePack {
  readonly id: LanguageId;
  readonly proficiency: ProficiencyFramework; // hsk-2025 (bands 1–6 and 7-9) | cefr (A1–C2)
  tokenize(text: string): readonly Token[];
  lookup(term: string): Promise<Result<readonly DictEntry[], LookupError>>;
  readonly features: {
    tones: ToneFeature | null;
    strokes: StrokeFeature | null;
    romanization: RomanizationFeature | null;
    decomposition: DecompositionFeature | null;
    ime: ImeFeature | null;
    phonetics: PhoneticsFeature | null;
  };
  readonly prompts: PromptPack;
}
```

Each module declares the features it requires; the module registry hides unsupported modules. Contract tests run against `lang-zh` and `lang-en` from M1 (minimal `lang-en` fixture stub first, full content in M9). Capabilities are added with the milestone that first uses them: `ime` (M4), `phonetics` (M3), `prompts` (M5).

### Code standards

- TS `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; typescript-eslint `strictTypeChecked`, `no-explicit-any`, `no-undefined` (absence = `null` or discriminated unions; third-party `undefined` wrapped at the boundary).
- Errors: `Result<T, E>` with typed error unions in `core`, zod at every I/O boundary, React error boundary per module, API global error handler with typed codes. No silent fallbacks: a failed fetch/model load/AI call is shown to the user.
- All code, comments, commits, branches, docs, issues in English. Minimal comments.

### Key technical choices

- **Storage**: Dexie (IndexedDB) + `navigator.storage.persist()` + JSON export/import backup. Review log append-only → card state recomputable, sync = log merge.
- **SRS**: `ts-fsrs` (MIT, FSRS-6). Card types per feature: recognition, recall, listening (all languages), tone (tones), writing (strokes), typing (ime). New-card priority: personal > level > frequency (Pareto).
- **zh text**: bidirectional maximum matching over CC-CEDICT headwords (deterministic in every browser and on the server, every segment is a dictionary word; `Intl.Segmenter` rejected for zh: engine-dependent and 7% of its segments missing from CC-CEDICT); pinyin conversion and tone sandhi (一, 不, third tone grouped by words) are in-house code over CC-CEDICT readings (pinyin-pro rejected: no third-tone sandhi, no validation of CC-CEDICT readings); text→pinyin with polyphone handling comes with the reader (M6).
- **Strokes**: Hanzi Writer + self-hosted `hanzi-writer-data` subset (HSK chars), service-worker cached.
- **Pitch**: `pitchy` (license to verify) F0 → semitones normalized to speaker mean → time-normalized comparison vs reference contour. Same code extracts reference contours in the pipeline and user contours in the browser.
- **TTS**: Kokoro rejected for Mandarin (all zh voices graded D); used for English (af_bella A-). Mandarin bake-off CosyVoice 3 (Apache-2.0, verify weights) vs MeloTTS (MIT) with human listening on tone minimal pairs + 3rd-tone sandhi. Engines run as Docker containers, the TS pipeline calls their HTTP API.
- **STT**: transformers.js Whisper (WebGPU, WASM fallback) in a Web Worker; opencc-js t→s conversion (Whisper may output traditional). STT checks intelligibility only; tone accuracy comes from the pitch module (CER hides same-character tone errors).
- **AI (BYOK)**: OpenAI-compatible client, JSON-schema structured output where supported, zod validation, retry/backoff on 429, explicit errors (CORS, 401, timeout). Key stays in IndexedDB, never sent to our API. Prompts versioned per language pack.
- **Comprehensible input**: target ≥98% known-word coverage (Hu & Nation 2000), configurable.
- **Backend security**: CORS allowlist, secure cookies, Better Auth CSRF, rate limits, zod + size limits, `secureHeaders`, plain-text submissions only, admin role via Better Auth admin plugin.

## Design & UX

### Principles
- "Ink and tone": calm, clean, modern; monochrome ink interface, color reserved for the tones, generous whitespace, flat surfaces, hanzi as the visual hero. Full spec in [`docs/design/DESIGN-SYSTEM.md`](design/DESIGN-SYSTEM.md).
- Gamification present but quiet: XP, streak, league badge in a slim header; no confetti walls, no guilt copy, streak freeze, opt-in notifications only. No dark patterns.
- Mobile-first: bottom tabs on mobile, sidebar from 1024px. One primary action per screen.
- Copy FR/EN, sentence case, encouraging, never shaming.

### System
- Tokens as CSS variables (Tailwind v4 theme): color, type scale, spacing, radius, motion; light / dark / system.
- Tone colors (T1–T4 + neutral): computed for contrast and colorblind separation (smallest ΔE ≥ 30 under protanopia, deuteranopia, tritanopia), always paired with diacritics (never color alone), on by default, toggle in settings.
- Fonts self-hosted and subset (unicode-range slices): Atkinson Hyperlegible Next (Latin UI), Noto Sans SC (Chinese UI, pinyin), LXGW WenKai GB (display characters, close to handwriting, mainland standard forms); all OFL-1.1; CJK slices cut by HSK band. No third-party font CDN (GDPR: IP transfer).
- Motion subtle, fully disabled under `prefers-reduced-motion`.

### Information architecture
- **Today**: one "Start" button runs the composed session (due reviews → new cards → tone drill → 5-sentence task), progress bar, daily goal.
- **Learn**: free access to decks, dictionary, pronunciation studio, writing studio, typing.
- **Read**: library (personal, AI, global), reader.
- **Profile**: stats, achievements, league, settings (AI provider, audio, display, privacy, data export/delete).
- Onboarding without account: target language → level (self-assessment or short placement) → daily goal → optional interests (personal vocabulary).

### Key screens to mock up before UI code
Today, review card (recognition / recall / listening / tone / writing variants), word page (decomposition tree), pronunciation studio (pitch overlay), writing studio (5 sentences + correction diff), reader with popup, profile/league.

## Accessibility (WCAG 2.2 AA)

- Reference: EN 301 549 v4.1.1 (published 2026-09-02, moves web baseline to WCAG 2.2; Official Journal citation expected Nov–Dec 2026). The EAA does not bind this project (microenterprise service providers are exempt under French law, see Privacy & compliance); WCAG 2.2 AA is a voluntary target.
- App-specific rules:
  - `lang="zh-Hans"` / `lang="en"` on every foreign-language span so screen readers switch voice (SC 3.1.2); pinyin via `<ruby>`.
  - Tone information never by color only (SC 1.4.1).
  - Stroke writing is a drag gesture → single-pointer alternative: stroke-order choice quiz or "show then self-grade" (SC 2.5.7).
  - Every mic exercise has a non-speech alternative ("can't speak now") and stays skippable without penalty.
  - No mandatory time limits: timed typing/league challenges adjustable or disableable (SC 2.2.1).
  - Targets ≥ 24×24 px (SC 2.5.8), visible unobscured focus (SC 2.4.7 / 2.4.11), reflow at 320 px and 200% text.
  - All audio has a text equivalent; animations respect reduced motion.
- Tooling: `eslint-plugin-jsx-a11y`, `@axe-core/playwright` in E2E (CI fails on violations), manual keyboard + NVDA + VoiceOver checklist per milestone.
- Accessibility statement page published at v1 (conformance level, known gaps, contact).

## Privacy & compliance (GDPR, AI Act)

### Verified legal basis (primary sources, checked 2026-10-09)

| Obligation | Source | Applies to us | Implementation |
|---|---|---|---|
| Lawful basis: contract / legitimate interest | GDPR art. 6(1)(b), 6(1)(f) (CNIL official text) | Yes | Account, sync, leagues = contract; security logs = legitimate interest |
| Minor's consent: 16 by default, member states down to 13; France 15, below 15 joint consent with a parent | GDPR art. 8(1); Loi Informatique et Libertés art. 45 (Légifrance, in force 2019-06-01) | Only for consent-based processing (none in v1) | Accounts 15+ by design choice, information written in plain language |
| Records of processing; <250-employee exemption does not apply to non-occasional processing | GDPR art. 30(5) | Yes | `docs/compliance/records-of-processing.md` |
| Breach notification to CNIL within 72 h | GDPR art. 33(1) | Yes | `docs/compliance/breach-procedure.md` |
| Consent-exempt trackers: authentication, intrinsic UI personalization (e.g. language), consent-choice storage | Loi I&L art. 82 + CNIL cookie guidelines 2020-09-17 | Yes | Session/CSRF cookies + language/theme only → no banner |
| Security log retention 6 months–1 year (default range) | CNIL délibération 2021-122 (2021-10-14) | Yes | API/Traefik logs purged at 6 months |
| Inactive accounts: 2 years after last user action as the reference | CNIL guidance (commercial-activities reference, non-binding) | Yes (analogy) | Notice email, then deletion at 2 years of inactivity |
| Legal notices: natural person → name, address, phone; publication director; host name/address/phone | LCEN art. 1-1 (created by SREN law 2024-449, in force 2024-05-23) | Yes | `/legal` page; self-hosted, so the maintainer is named as host |
| AI interaction disclosure (providers) | AI Act art. 50(1), applies from 2026-08-02 (art. 113) | Yes, we build the AI-integrated system | Visible "AI" label on every AI feature and output |
| Machine-readable marking of synthetic text (providers); standard-editing assistance exempt | AI Act art. 50(2) | Yes for generated stories/sentences; corrections likely under the editing exemption | `origin: "ai"` + model/provider metadata stored and exposed in exports and library API |
| AI-generated public-interest text disclosure (deployers) | AI Act art. 50(4) | Unlikely (learning content), human-reviewed library anyway | Badge kept on library items |
| Accessibility of services (EAA) | Directive 2019/882 → Code de la consommation L.412-13, D.412-49 et seq., décret 2023-931; microenterprises providing services (<10 staff, ≤€2M) exempt | No (non-commercial individual, below thresholds) | WCAG 2.2 AA as a voluntary target + accessibility statement |

Watch items: décret 2026-883 (2026-09-23, accessibility enforcement) and EN 301 549 v4.1.1 Official Journal citation (expected Nov–Dec 2026); review both at M10. Not legal advice.

### Measures

- **Data map**: on-device only → cards, review logs, recordings, journal, AI key (never reaches our servers). Server → account (email, pseudonym, password hash, OAuth ids), sessions, submissions (text + attribution + license attestation), synced logs, league XP, security logs (IP).
- **Legal bases**: contract (account, sync, leagues opt-in), legitimate interest (security logs). No consent-based processing in v1.
- **Cookies**: only strictly necessary (session, CSRF) → exempt from consent per CNIL, no banner. No analytics in v1; if added later, CNIL-exempt self-hosted configuration only.
- **No third-party runtime requests by default**: fonts, Hanzi Writer data, audio, Whisper models served from our own origin/CDN (mirroring vs informing the user for model downloads decided in M3).
- **BYOK AI**: clear notice before first call naming the endpoint the user configured; data flows device → provider, never through us.
- **Voice**: processed on-device (Whisper, pitch), recordings stored locally and deletable, never uploaded.
- **Minors**: app usable without account by anyone; accounts 15+ (age declaration, France digital majority). League pseudonyms + predefined avatars only, no messaging, no profiling, no ads.
- **Rights**: in-app export (JSON) and account deletion (hard delete cascade), profile rectification, contact address.
- **Docs** (`docs/compliance/`): records of processing, data map, retention schedule (logs 6 months, inactive accounts 2 years), sub-processors (Cloudflare, Google/GitHub OAuth, SMTP provider), breach procedure (72 h), DPIA screening, privacy policy, legal notices.

## Deployment

Infrastructure specifics (hosts, ports, credentials) live in the maintainer's private infrastructure docs, not in this repo.

- **API**: Docker image built by GitHub Actions → GHCR, deployed on a self-hosted Docker host behind Traefik at `openlinguo-api.razakk.fr` (Let's Encrypt TLS, security-headers + rate-limit middlewares, API handles its own auth). Port bound to the internal network only.
- **Database**: dedicated Postgres 16 database `openlinguo` + least-privilege user; password generated server-side and passed as a Docker secret (`_FILE`), never in clear. Migrations run as a one-shot container before start; nightly `pg_dump` backup; uptime and log monitoring.
- **PWA**: Cloudflare Pages with custom domain `openlinguo.razakk.fr`. Same registrable domain as the API → `SameSite=Lax` first-party cookies, CORS allowlist `https://openlinguo.razakk.fr` with credentials. `*.pages.dev` is not used for users (API cookies would become third-party, blocked by Safari).
- **Headers**: the reverse proxy's shared security headers send `Permissions-Policy: microphone=()`; this only affects documents it serves, so the PWA must never be served through it. The PWA's own `_headers` set `microphone=(self)`, a strict CSP and HSTS.

## Data sources (checked 2026-10-09)

All sources were verified on primary sources; the full table, obligations and attribution text live in [`data/SOURCES.md`](../data/SOURCES.md).

| Dataset | License |
|---|---|
| CC-CEDICT | CC BY-SA 4.0 |
| CFDICT | CC BY-SA 3.0 |
| HSK 2025 exam syllabus (official CTI PDF is copy-protected: pinned harukicoder/hsk30 transcription, permission requested; exam launch 2026-12-13) | Factual level mapping, attributed |
| Make Me a Hanzi / hanzi-writer-data | LGPL-3.0+ / Arphic PL |
| Wiktionary (kaikki.org), wordfreq, Octanove C1/C2 | CC BY-SA 4.0 |
| CEFR-J 1.6 | Free with citation; redistribution not addressed (accepted risk) |
| Tatoeba sentences (text only) | CC BY 2.0 FR |
| Kokoro-82M / CosyVoice 3 / MeloTTS | Apache-2.0 / Apache-2.0 / MIT |

Freshness rule: each manifest entry carries `retrievedAt` + `maxAgeDays`; a CI job fails when an entry is expired, a monthly workflow pushes a refresh branch and opens an issue with diff stats; the maintainer opens and reviews the PR, never auto-merged. Commercial graded readers are never ingested; Tatoeba audio not used (mixed NC licenses).

## Milestones

Each milestone ships a usable increment (tagged `0.x`). Exit criteria = verification.

**M0 — Foundations.** Monorepo, strict TS + lint, Vitest, CI (typecheck/lint/test/build), supply-chain baseline (pinned actions, minimal permissions, dependency-review with license allowlist, CodeQL, OSV-Scanner, Dependabot, pnpm lifecycle-script allowlist), rulesets on `main`, CODEOWNERS, `Result` type, source/license verification → `data/SOURCES.md`, design tokens + mockups of the key screens (validated by the maintainer before any UI code), compliance baseline (data map, privacy-by-design checklist, accessibility statement template). *Exit: green CI on a trivial package, all "to verify" sources resolved or replaced, mockups approved.*

**M1 — Data + LanguagePack + dictionary.** Pipeline + manifest + freshness check, CC-CEDICT/CFDICT/HSK-2025/MMAH imports, LanguagePack interface + contract tests (zh + en stub), lang-zh pinyin/segmentation/decomposition, PWA shell (offline, i18n FR/EN, Dexie loader, shadcn/ui + tokens, light/dark, bottom tabs/sidebar), self-hosted subset fonts, a11y CI (jsx-a11y + axe), dictionary search, word page (glosses, HSK level, decomposition tree, stroke animation). *Exit: offline search 电话 → 电 + 话 tree + strokes, E2E + axe green.*

**M2 — SRS + local gamification.** Card model, FSRS sessions, decks (HSK level, from dictionary), session composer, stats (retention, heatmap), XP/levels/streak/daily goal/achievements as pure functions of the review log, backup export/import. *Exit: 7-day simulated schedule matches ts-fsrs, XP deterministic from logs.*

**M3 — Audio & pronunciation.** TTS bake-off + ADR, audio packs per level (hosting limits verified), F0 reference contours, mic capture + pitch visualizer + tone score, shadowing (play → record → A/B replay), Whisper STT + t→s + char/pinyin diff, tone card type, non-speech alternative on every mic exercise, model hosting decision (mirror vs notice). *Exit: tone classifier passes fixture accuracy threshold, works on Chrome + Safari.*

**M4 — Writing & typing.** Hanzi Writer quiz mode (writing card type) + single-pointer alternative, in-app pinyin IME from CC-CEDICT + frequency, typing exercises (timers optional). *Exit: write/typing cards scheduled by FSRS, keyboard-only path works.*

**M5 — AI mobilization (BYOK).** Provider settings + connection test, 5-sentence challenge, daily journal, correction diff view, corrected sentences → proposed cards, personal vocabulary from profile (proposals filtered against dictionary, user validates), AI story generation with coverage check. *Exit: works against Groq, OpenRouter and Ollama, invalid responses rejected with visible error.*

**M6 — Graded reader.** Reader (segmentation, tap popup, add-to-SRS, known-word highlighting, coverage %), user import (paste, .txt), AI stories stored locally. *Exit: imported text shows coverage, popup lookup offline.*

**M7 — Backend & shared library.** Hono API, Drizzle migrations, Better Auth (email/password + Google + GitHub, email verification), submissions with CC BY-SA 4.0 attestation, server-side level estimate, admin moderation UI, public library endpoints (AI badge + origin), takedown process, age gate 15+, account export/delete, retention jobs (logs 6 months, inactive accounts 2 years), privacy policy + legal notices + records of processing, self-hosted deploy (see Deployment), PWA on Cloudflare Pages custom domain. *Exit: submit → admin approve → visible to another device; export/delete verified end to end.*

**M8 — Sync + leagues.** Append-only review-log sync + LWW card content sync, server recomputes XP from logs, weekly leagues opt-in (pseudonyms, predefined avatars, no messaging), plausibility caps (local-first cannot fully prevent cheating — documented). *Exit: two devices converge, league table from server-computed XP.*

**M9 — lang-en core.** Wiktionary (kaikki) EN glosses + FR translations, IPA, CEFR-J levels, wordfreq, Kokoro audio, en prompts. Generic modules work for en; zh-only modules hidden. *Exit: contract tests green for both packs, full learning loop in en.*

**M10 — v1.0 hardening.** Manual accessibility audit (keyboard, NVDA, VoiceOver) + published accessibility statement, GDPR review of docs vs implementation, performance (dataset load time, bundle), FSRS parameter optimization (optional), CONTRIBUTING, contributor PR gates (fork-run approval, OpenSSF Scorecard, CODEOWNERS on workflows/pipeline/lockfile), docs, release v1.0.0.

**Post-v1.** Capacitor iOS/Android (+ Sign in with Apple if required), OCR (PaddleOCR ONNX / Tesseract.js), traditional script toggle, more languages.

## Risks

1. Scope for a solo dev → milestone increments, strict YAGNI per milestone.
2. HSK 2025 provenance → M0 verification, versioned dataset, count sanity tests.
3. Mandarin TTS tone quality → bake-off + human listening, fallback to CC-licensed native recordings.
4. Whisper size on mobile → on-demand download, model choice benchmarked in M3, feature optional.
5. iOS PWA storage eviction → `persist()`, backups, Capacitor post-v1.
6. BYOK CORS differs by provider → documented tested providers; CSP `connect-src` must allow user endpoints (trade-off in ADR).
7. User submissions copyright → attestation, moderation, takedown.
8. Homelab exposure → API only, TLS via Traefik, rate limits, backups, monitoring.
9. Open choices deferred to their milestone: SMTP provider (M7), audio hosting Pages vs R2 vs self-hosted S3 (M3), model download mirroring (M3).
10. Legal basis verified on primary texts, but not legal advice; watch items re-checked at M10.
11. Visual-only widgets (pitch curve, decomposition tree, heatmap) need text alternatives (numeric score, tone label, list view).

## Quality gates

- Every milestone's exit criteria are enforced by CI: typecheck, lint, unit, LanguagePack contract tests, E2E (Chromium + WebKit) with axe accessibility checks, data freshness check.
- Every PR requires green CI and a human review; dependency, license and security scans block on findings.
