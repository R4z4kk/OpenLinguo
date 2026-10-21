# Wikidata lookup

The analysis behind « Chercher sur Wikidata » in the unknown-words panel ([ADR 0014](../adr/0014-graded-reader.md), #230). Every source was read on 2026-10-21 on Wikimedia's own pages. This is not legal advice. When a change touches this lookup, its endpoint or what it sends, update this document in the same pull request.

Sources:

- [Wikidata Query Service user manual](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual) (edited 2026-10-01): endpoint, limits.
- [WDQS backend update](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/WDQS_backend_update) (edited 2026-10-17) and its [Migrate page](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/WDQS_backend_update/Migrate) (edited 2026-10-17): the move from Blazegraph to QLever.
- [Wikimedia Foundation User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) (edited 2026-03-27).
- [Wikimedia privacy policy](https://foundation.wikimedia.org/wiki/Policy:Privacy_policy) (in force 2025-10-06) and [data retention guidelines](https://foundation.wikimedia.org/wiki/Policy:Data_retention_guidelines) (edited 2026-02-20).
- [Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing) (edited 2026-09-24): structured data is "released into the public domain under Creative Commons Zero".
- CJEU [C-40/17 Fashion ID](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62017CJ0040) and the sources of [AI features](ai.md), whose section 1.2 this one follows.

## 1. What leaves the device

When the learner presses « Chercher sur Wikidata », after the notice shown before the first call, the browser sends one `GET` to `https://query.wikidata.org/sparql` per 50 sequences, one after the other.

| Sent | Where |
|---|---|
| The unknown character sequences (names of people, places, organizations), at most 30 characters each, never the sentence, the text or its title | In the web address of the request, so in Wikimedia's request logs |
| The IP address and the browser's user agent | As for any website; the Foundation lists both as personal information |
| `Api-User-Agent: OpenLinguo (https://github.com/R4z4kk/OpenLinguo)` | The header its [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) encourages browser apps to send; it names the app and a contact (the repository), not the learner |

The request carries no cookie (`credentials: "omit"`) and no referrer (`referrerPolicy: "no-referrer"`). The « Envoyé : … » line says the same under the button.

Wikimedia keeps request logs on servers "located in the U.S.", and its privacy policy says that personal information is "in most instances" deleted, aggregated or de-identified after 90 days. The [retention guidelines](https://foundation.wikimedia.org/wiki/Policy:Data_retention_guidelines) are more exact: IP address and user agent "after at most 90 days", and system backups "not to exceed 5 years". The privacy notice says both.

## 2. Roles: most likely not a controller

The two criteria of [AI features](ai.md#12-gdpr-most-likely-not-a-controller-of-the-ai-calls) are met. The lookup is "initié à la discrétion de la personne" (one click per text), and OpenLinguo "ne peut plus agir en aval sur les données": it receives nothing, keeps no log and has no account on the service. The learner is covered by the household exemption (GDPR art. 2(2)(c)).

**What differs from the AI calls.** The learner picks no destination: the app fixes it, where for AI the learner picks the provider and brings their own key. Condition 2 of the AI analysis cannot hold, so the Fashion ID risk is larger here. OpenLinguo decides which data goes in the request (the sequences) and where it goes, and the Court made the operator of a site joint controller of a transmission it had embedded, without it ever receiving the data (para 78 to 80). OpenLinguo has none of the commercial advantage the Court relied on: it earns nothing from the lookup and measures nothing.

**Conditions that keep the analysis.** Each is a rule of ADR 0014. Breaking any of them reopens it.

1. Every lookup starts with a click by the learner. Nothing is sent in the background, and nothing is retried silently.
2. The notice before the first call names the recipient, its country, what is sent and the retention.
3. Only the unknown sequences are sent. The « Envoyé : … » line shows it before each click.
4. There is no relay, proxy, analytics or log. Requests go straight from the browser to the service, and the CSP `connect-src` lists its origin.
5. OpenLinguo receives nothing from Wikimedia: no payment, no affiliate link.

**What would make OpenLinguo a controller:** a relay or CORS proxy, a lookup in the background or on opening a text, telemetry on lookups.

**If an authority took the joint-controller view**, OpenLinguo would answer for the collection and transmission only. It would owe the art. 13 information, which the notice gives, and a legal basis for that step. The click that follows the notice would be an informed, explicit act by the learner, the nearest thing to the explicit consent that art. 49(1)(a) asks for to transfer data to the U.S.; it is not relied on. Nothing is presented to the learner as a GDPR consent.

## 3. The transfer to the U.S.

The privacy policy says that personal information "will be collected, transferred, stored, processed, disclosed and otherwise used in the U.S." (section 5.1). It names neither the EU-U.S. Data Privacy Framework nor Standard Contractual Clauses. Whether the Foundation is certified was not checked: the official list at [dataprivacyframework.gov](https://www.dataprivacyframework.gov/list) cannot be read without a script, so the maintainer looks it up there (section 5). The learner's browser makes the transfer, and OpenLinguo, most likely not a controller, signs nothing with Wikimedia: [sub-processors](sub-processors.md#wikidata-queried-by-the-learner) does not list it as a sub-processor.

## 4. Dated values

`WIKIDATA_ENDPOINT` in `packages/core/src/wikidata.ts` holds the endpoint with its source and the date it was read. Its review date, 2027-01-15, comes before the old service may degrade: the backend update page says that the "original Blazegraph endpoints will still be available, but may experience service degradation beginning February 2027". A CI test fails on that date until the pages above are read again and `checkedOn` and `reviewBy` move.

At that review, check:

- whether `query.wikidata.org` still answers the query of the client, and whether the limits of the user manual still hold (60 s per query, 60 s of processing per 60 s, 5 parallel queries per IP, 429 with `Retry-After`);
- whether v2, `query-next.wikidata.org` (it answers "Unauthorized User-Agent" until it is public), has opened: the endpoint and the CSP `connect-src` change together in one pull request, and so do the notice and this document.

## 5. Re-check before the M6 release

State on 2026-10-21:

| Item | State | Source |
|---|---|---|
| Wikimedia Foundation on the Data Privacy Framework list | Not checked: the list is not readable without a script. Its privacy policy names no transfer mechanism | [Privacy policy](https://foundation.wikimedia.org/wiki/Policy:Privacy_policy) section 5.1 |
| Request URL size | The service answers 431 above 8 KiB of request headers: a 7,653-character URL failed, a 6,753-character one passed in Chromium. The client splits batches at 6,000 characters | Measured 2026-10-21 |
