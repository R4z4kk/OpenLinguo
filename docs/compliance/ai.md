# AI features (BYOK)

The legal analysis behind [ADR 0012](../adr/0012-ai-mobilization-byok.md). Every source was read on 2026-10-19 on its official site, and quotes are verbatim. This is not legal advice. When a change touches an AI feature, a provider preset or the provenance field, update this document in the same pull request.

Sources:

- AI Act: [consolidated text of 27.07.2026](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727) (a documentation tool) and [the Official Journal text](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) for the recitals.
- Commission [guidelines on article 50](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems): C(2026) 5054, 20.7.2026, non-binding. Cited below as "guidelines".
- [Code of practice on transparency of AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content): final, 10 June 2026. Cited below as "the code".
- [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- CNIL [recommendation on mobile applications](https://www.cnil.fr/sites/cnil/files/2025-04/recommandation-applications-mobiles-modifiee.pdf): délibération 2025-024. It covers PWAs.
- CJEU [C-40/17 Fashion ID](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62017CJ0040) and [C-25/17 Jehovan todistajat](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62017CJ0025).
- EDPB [guidelines 07/2020](https://www.edpb.europa.eu/system/files/documents/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf) on controller and processor, v2.1.
- [Loi Informatique et Libertés, art. 82](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000037813978).

## 1. Roles

### 1.1 AI Act: OpenLinguo is treated as the provider

- An AI model needs "further components, such as for example a user interface" to become an AI system (recital 97). OpenLinguo supplies the interface, the prompts and the validation around the learner's model, under its own name. That makes it the provider of the system (art. 3(3)).
- Neither the price nor the license changes this:
  - the provider definition applies "whether for payment or free of charge" (art. 3(3));
  - the open-source exclusion stops at systems that fall "under Article 5 or 50" (art. 2(12)).
- Learners are not deployers. A deployer uses a system "except where the AI system is used in the course of a personal non-professional activity" (art. 3(4)), and art. 2(10) removes those duties.
- The companies hosting the models (Groq, OpenRouter, Mistral) provide the models. A provider may rely on an upstream marking solution (guidelines para 74). OpenLinguo relies on none and marks its outputs itself (section 4).
- Art. 50 applies from 2 August 2026 (art. 113). The four-month delay of art. 111(4) only covers systems "placed on the market before 2 August 2026". OpenLinguo had no AI feature then, so M5 must comply when it ships.
- Open point: "making available on the market" requires a commercial activity (art. 3(10)), and "putting into service" is defined in relation to a deployer (art. 3(11)). A free app used by private persons might fall outside both. No authority has said so, and compliance costs little, so OpenLinguo assumes it is the provider.

### 1.2 GDPR: most likely not a controller of the AI calls

**Data that stays on the device.** The journal, the challenges, the corrections, the interests and the settings never leave the device unless the learner sends them. The CNIL sets two cumulative criteria, and both are met:

- the processing is "initié à la discrétion de la personne";
- the supplier of the software "ne peut plus agir en aval sur les données".

When both hold, "l'acteur ne fait que fournir un logiciel", and the GDPR does not apply to that software (CNIL, §3.3). The learner is covered by the household exemption (GDPR art. 2(2)(c)).

**AI calls.** When the learner presses an AI button, the browser sends the payload and the learner's key to the provider the learner chose. In the CNIL's terms, the provider is "le tiers qui traite les données à la demande de la personne". That third party carries the GDPR duties as controller or processor (§3.3). OpenLinguo never receives the data.

- To be a controller, a person must exert influence "for his own purposes" (C-25/17 para 68). OpenLinguo has no purpose of its own in these calls: it earns nothing from them, measures nothing and receives nothing.
- Fashion ID became joint controller because it embedded the plugin "to benefit from the commercial advantage consisting in increased publicity" (para 80). OpenLinguo has no such interest.

**Conditions that keep it so.** Each one is a rule of ADR 0012. Breaking any of them reopens this analysis.

1. Every call starts with a click by the learner. Nothing is sent in the background.
2. The learner picks the provider and pastes their own key. No provider is preselected, and no key is shared or bundled with the app.
3. There is no relay, proxy, analytics or log. Requests go straight from the browser to the provider, and the CSP `connect-src` only lists the presets and local servers.
4. Each feature sends only what it needs. The « Sent: … » line shows this before the click.
5. OpenLinguo receives nothing from providers: no affiliate link, no paid placement.

**Residual risk (Fashion ID).** The Court made the site operator joint controller of a transmission it had embedded, because it "exerts a decisive influence over the collection and transmission" (para 78). The operator never received the data. Its responsibility stopped at operations whose purposes or means it did not determine (para 74).

OpenLinguo, too, decides which data goes into each prompt, and the EDPB counts "the type of personal data which are processed" among the essential means (para 40). If an authority took that view, OpenLinguo would be joint controller of the collection and transmission only. It would then owe the art. 13 information and a legal basis for that step. The notices of ADR 0012 already give that information. No authority has yet ruled on bring-your-own-key apps.

**What would make OpenLinguo a controller or a processor:** a relay or CORS proxy, a default or shared key, telemetry on AI use, sending data in the background, or payment from a provider.

**Consequences:**

- OpenLinguo asks for no GDPR consent, and no AI switch is presented as consent.
- The notices are given anyway (ADR 0012).
- This section records the role analysis, as the CNIL asks: actors "doivent être en mesure d'expliquer la qualification retenue" (§4.1).

### 1.3 Storing the key

- Writing the key to IndexedDB is an "inscription d'informations dans l'équipement terminal" (art. 82). It needs no consent: it is "strictement nécessaire à la fourniture d'un service de communication en ligne à la demande expresse de l'utilisateur" (art. 82, 2°), because the learner pastes the key in order to use the AI features. The same holds for the chosen provider and model, and for the record that the AI notice was seen.
- Reading the journal from IndexedDB to send it is an "accès aux informations stockées". It is exempt on the same ground, because only the learner's click triggers it. Sending in the background would lose that ground.
- Art. 82 does not require telling users about exempt storage. The CNIL still recommends mentioning it in the privacy policy (délibération 2020-092 para 49). That mention is in the [privacy notice](privacy-notice.md).

## 2. AI Act art. 50, per output

- **Art. 50(2): marking.** Outputs must be "marked in a machine-readable format and detectable as artificially generated or manipulated". This does not apply where the system performs "an assistive function for standard editing" or does "not substantially alter the input data".
- **Art. 50(1): disclosure.** People must be "informed that they are interacting with an AI system". A "single prompt followed with a single reply" counts as an interaction (guidelines para 30).
- **Art. 50(5): when and how.** The information is due "at the latest at the time of the first interaction or exposure", and it must meet accessibility requirements.
- **Art. 50(3) and 50(4) do not apply.** 50(3) covers emotion recognition and biometric categorisation. 50(4) covers deep fakes and text published to inform the public. OpenLinguo produces no image, audio or video and publishes nothing.

| Output | Art. 50(2) | Why |
|---|---|---|
| Corrected sentences of the challenge and the journal (#183, #184, #185) | Exempt | The guidelines list "Grammar correction and spellchecking, linguistic and minor stylistic polishing" as standard editing (examples after para 92). The correction prompt asks for minimal fixes that keep the meaning and the style (#180). No rewrite mode is offered, because "paraphrasing or rewriting text that changes style, structure and meaning" requires marking (same list). |
| Pinyin and French meaning of a corrected sentence, and the card made from it (#186) | Exempt | The pinyin transcribes the learner's sentence, and the meaning is a translation of it. The same list exempts "AI-generated translations of text". |
| Explanation of each change | In scope, very short text | This is new text, one or two sentences per change. That is far below the 200 tokens from which the code requires a watermark (section 3). It is marked by the provenance field and the badge. |
| French glosses of a dictionary entry (#188) | Exempt | These are "AI-generated translations of text". Glosses are also short labels, like the "single words, image captions, alt-text, UI labels" that para 68 places outside 50(2). |
| Words suggested from interests (#187) | Outside | The AI returns headwords. Only those that are dictionary entries are kept, and they are shown with the dictionary's own pinyin and glosses. The AI only selects existing content, like systems that "only select or rank existing content" (para 65). |
| Story generation, its coverage check and the « explain unknown sequences » call | M6 | These moved to M6 (#34). A story is new text and often longer than 200 tokens, so it is in scope and the code expects a watermark. M6 decides how to handle it, using section 3. |

**Art. 50(1) and (5).** « Correct » is a prompt followed by a reply, so it is an interaction. « Suggest words » and « Translate to French » are arguably outside 50(1): the guidelines list "automated translation or transcription tools" among the systems that do not interact (§3.2.1). OpenLinguo treats every AI feature the same way anyway (#182, #207):

- **Before the first AI call of any kind**, « Tester la connexion » included, one notice says that a machine writes the answers and can be wrong, and what each AI button sends. Once confirmed, it never shows again. The connection test sends a sentence through the correction prompt, so it is already an interaction.
  - "A single, prominent notification before the first interaction of the AI system with a particular natural person is likely to suffice in most instances" (para 40).
  - Teenagers may use the app, so the notice must be "child-friendly, age-appropriate, easy-to-understand" (para 34).
  - Para 40 asks for periodic reminders in riskier contexts, children included, and para 143 asks for the information "at least" once "at the start of an interactive session". Each OpenLinguo call is one prompt and one reply, started by one button. The reminder stays next to every call: the « Envoyé à … » line under the button and the badge beside the output, as para 37 recommends ("position accompanying disclosures close to the interaction interface"). The maintainer chose this reading on 2026-10-20, after the M5 manual run (#207). Checked that day: the consolidated text of 27.07.2026 is still the current one, and art. 50(5) and the guidelines read as quoted.
  - The "obvious" exception, which needs "almost no doubt left" (para 45), is not relied on.
- **Beside every output**, « Generated by AI · model » appears as text with an icon and is read by screen readers. This is the persistent badge para 37 suggests.

## 3. Gap analysis against the code of practice

The Commission and the AI Board confirmed the code as "an adequate voluntary tool". OpenLinguo does not sign it. A provider that does not sign "should carry out a gap analysis that compares the measures they have implemented" with the code's (guidelines para 148). The comparison below covers Section 1 of the code, on marking and detection, which is addressed to providers. Section 2 covers deployer labels under art. 50(4) and does not apply.

In M5, the only outputs within art. 50(2) are the explanations of changes, each shorter than 200 tokens (section 2).

| Code measure | What it asks | OpenLinguo in M5 | Gap |
|---|---|---|---|
| 1.1 Machine-readable marking | At least one technique. For free-form text, "a single-layer of marking" (a watermark) suffices | The provenance field on every stored AI item (section 4) | See 1.1.1 and 1.1.2 |
| 1.1.1 Signed metadata | Where the format carries metadata: record the AI origin, signed and time-stamped, unless "in a local deployment scenario" | Origin and `createdAt` recorded, unsigned | Unsigned. A client-only app has nowhere to keep a signing key safe, which is the code's own local-deployment exception |
| 1.1.2 Imperceptible watermark | A watermark, "with the exception of very short text" (under 200 tokens, per the glossary) | None | None in M5: explanations are very short text. M6 stories go over 200 tokens and remain open. Under para 81, a provider is "not obliged to make use of a technical solution that is not yet developed" |
| 1.1.3 Fingerprinting or logging (optional) | — | Nothing is logged | — |
| 1.2 Non-removal of markings | Forbid stripping them. For open source, it is enough to "alert users to this best practice in the documentation" | Section 4 asks users not to strip the field. Backup export and import keep it (#182) | None |
| 1.3 Provenance information (optional) | AI system, provider, timestamp, model | `provider`, `model`, `promptVersion`, `createdAt` | — |
| 1.4 Perceptible labels (optional) | — | A badge on every output | — |
| 2.1 Detection, free of charge | May be "a public, ideally standardised, specification"; a reference implementation is encouraged | Section 4 is the public specification. The zod schema `AiProvenance` (#182) is the reference implementation | The format is OpenLinguo's own, not a standard |
| 2.2 Forensic detection (optional) | — | None | — |
| 2.3 Disclosure of detection results | Clear results that say which technique was used | The badge names the origin and the model. Section 4 says the field is metadata | None |
| 2.4 Literacy (optional) | — | The AI notice says machine output can be wrong | — |
| 3 Effective, reliable, robust, interoperable | All four, as far as technically feasible | Effective and reliable inside the app: the code that stores the answer also sets the field. Interoperable through this public specification | Not robust: copying the text elsewhere drops the field, and anyone can edit a backup file. Metadata on short text has this limit by nature |
| 4.1 Compliance process | Documented, proportionate for SMEs | This document and the pull request checklist (« AI output is labeled and stored with its provenance ») | None |
| 4.2 Testing | Before release and regularly | Unit tests on the provenance schema and the backup round trip (#182). E2E tests on recorded responses (#190) | No detection benchmark, as none exists for metadata |
| 4.3 Training | Proportionate training of personnel | One maintainer, no staff. This document | None |
| 4.4 Cooperation with authorities | Provide documentation on request | This document is public. The contact is the repository until the legal notice ships (M7) | The French authority is not designated yet (section 5) |

## 4. Provenance: the public detection specification

This section is how anyone can tell whether an OpenLinguo item came from an AI model: by reading this field (code, Sub-measure 2.1.1(i)). #182 implements it, and the zod schema `AiProvenance` in `packages/core` is the reference implementation. Any change to the field updates this section in the same pull request.

```json
{
  "provenance": {
    "origin": "ai",
    "provider": "local",
    "model": "qwen3:30b-a3b",
    "promptVersion": "zh-correct-v1",
    "createdAt": "2026-10-19T14:03:27.512Z"
  }
}
```

| Member | Type | Meaning |
|---|---|---|
| `origin` | `"ai"` | The item was generated by an AI model |
| `provider` | `"groq"`, `"openrouter"`, `"mistral"` or `"local"` | The preset the request went to. `local` is a server on `localhost` or `127.0.0.1`; its address is not recorded |
| `model` | string | The model id sent in the request, as listed by the endpoint's `GET /models` |
| `promptVersion` | string | The PromptPack task and version that built the request, such as `zh-correct-v1` |
| `createdAt` | string, ISO 8601 in UTC | When the answer was received |

- **Where it appears.** Every stored AI item carries a `provenance` member, both in IndexedDB and in the backup file. These items are corrections, cards made from a corrected sentence, and AI glosses. The learner's own sentences carry none. Suggested words carry none either, because they are dictionary entries and contain no AI text.
  - A note (`notes` in the backup file) has `provenance` set when it was made from a corrected sentence, and `null` when the learner wrote it or imported it from Anki. A backup made before M5 has no such member: it reads as `null`.
- **Who sets it.** The code that validated the answer sets the field when it stores the item. The model's output never sets it.
- **What it never holds.** No learner identity, key, endpoint address or prompt text. The guidelines say "the information related to the creator of the content should not be processed" (para 94).
- **Edits.** The field stays when the learner accepts a correction, makes a card from it or edits the item: it records where the item came from, not who changed it last.
- **Detection rule.** An item is AI-generated if and only if it has a `provenance` member whose `origin` is `"ai"`. A `provider` or `promptVersion` value a reader does not know still means AI-generated.
- **Versioning.** Members may be added. Existing members are never renamed or removed, so older backups stay readable.

**Please keep it.** If you fork OpenLinguo, convert its backup file or reuse its AI items, do not strip or alter the `provenance` field. It is how readers and authorities can tell that a text came from a machine. The AGPL lets you change the code: this is a request, not a license term.

## 5. Re-check before the M5 release

State on 2026-10-19:

| Item | State | Source |
|---|---|---|
| Joint Commission and EDPB guidelines on the AI Act and data protection law | Not published. Footnote 37 of the art. 50 guidelines calls them "under preparation", and they are on neither the EDPB news page nor its guidelines page | [EDPB news](https://www.edpb.europa.eu/news/news_en), [EDPB guidelines](https://www.edpb.europa.eu/our-work-tools/general-guidance/guidelines-recommendations-best-practices_en) |
| French authority supervising art. 50 | Not designated in law yet. The government plan gives art. 50(1) and (2) to the DGCCRF and Arcom. The bill that would do so has been at the Assemblée nationale (text n° 2518) since 20 February 2026. The Senate adopted it on 18 February 2026, as text n° 63, arts 24 quinquies and 24 terdecies | [DGE, 9 September 2025](https://www.entreprises.gouv.fr/priorites-et-actions/transition-numerique/soutenir-le-developpement-de-lia-au-service-de-0), [Senate file](https://www.senat.fr/dossier-legislatif/pjl25-118.html) |
| A CNIL, EDPB or CJEU position on bring-your-own-key apps | None found | Section 1.2 |
| Watermarking of generated stories | Open, decided in M6 | Section 3 |
