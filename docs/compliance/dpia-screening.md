# DPIA screening

Screening against the nine criteria of the Article 29 Working Party guidelines on DPIA ([WP 248 rev.01](https://ec.europa.eu/newsroom/just/document.cfm?doc_id=47711), last revised and adopted on 2017-10-04, under the [EDPB's endorsement](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/data-protection-impact-assessments-high-risk-processing_en) of 2018-05-25). The guidelines, their pages 8 to 12, were read in full text on 2026-11-04. The controller read both CNIL lists of types, by their titles, the same day. This is not legal advice.

What the guidelines say about the count:

- In most cases, "a processing meeting two criteria would require a DPIA".
- In some cases, a controller can consider that "a processing meeting only one of these criteria requires a DPIA".
- "In cases where it is not clear whether a DPIA is required", they recommend that one "is carried out nonetheless".

Neither CNIL list matches. Délibération [2018-327](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000037559521) lists 14 types of processing that require a DPIA, and says the list is not exhaustive (that sentence through a summarising fetch). The nearest is large-scale location data: an IP address per upload, for a small project, is not that. Délibération [2019-118](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000039248939) lists 12 types that are exempted, none of them this one.

| # | Criterion | Applies? | Reasoning |
|---|---|---|---|
| 1 | Evaluation or scoring | No | Nobody is ranked: leagues were dropped on 2026-11-03 ([ADR 0016](../adr/0016-sync.md)). The level estimate scores texts, not people. Schedules and progress statistics are computed on the device, and the server does not decode what it stores |
| 2 | Automated decision with legal or similar significant effect | No | Scheduling has no legal or similar effect: "Processing with little or no effect on individuals does not match this specific criterion" |
| 3 | Systematic monitoring | No, the closest call | The criterion is "processing used to observe, monitor or control data subjects", and "systematic" includes "occurring according to a system". Hosting records are systematic in that sense: an IP address per upload, kept a year. But neither they nor review times are used to observe anyone: the routes do not decode chunks, and the records are read only to answer an authority or the person. The reason given for the criterion, that people "may not be aware of who is collecting their data", does not fit an opt-in that explains this first and can be turned off. Any other use of these data would change this answer |
| 4 | Sensitive or highly personal data | **Treated as yes, from M8** | Voice, the journal and texts stay on the device, so nothing of Art. 9 is expected on the server. But the criterion covers data "linked to household and private activities", and "may also include" "notes from e-readers equipped with note-taking features" and "very personal information contained in life-logging applications". Sync sends notes and deck names the learner can type freely, and a log of reviews with their time and time zone, for years, which the maintainer could read. A flashcard is not a diary and a study log is not obviously "very personal", so the criterion is not clearly met; the text does not exclude it either. The guidelines recommend carrying out a DPIA when it is not clear; they do not ask to count a criterion. It is counted here as the cautious reading |
| 5 | Large scale | No, for now | Small open-source project, on the guidelines' four factors: people, volume, duration, geography. Chunks can stay for years, so reassess if accounts grow significantly |
| 6 | Matching or combining datasets | No | No data enrichment or cross-referencing |
| 7 | Vulnerable data subjects | **Yes** | "Vulnerable data subjects may include children": accounts open to 15–17-year-olds |
| 8 | Innovative use of technology | No on the server | Speech runs on the device. The AI features (M5) use generative models, a new technology, but the requests go from the learner's device to the provider they chose, and OpenLinguo is most likely not a controller of them ([AI features](ai.md#12-gdpr-most-likely-not-a-controller-of-the-ai-calls)); art. 35 binds controllers. Reassess if OpenLinguo adds a relay, a shared key or server-side AI |
| 9 | Prevents exercising a right or using a service | No | The app works fully without an account, and sync is opt-in |

## Conclusion

M7 (accounts, shared library) meets one criterion (7): a DPIA is not mandatory for it.

Without leagues, criterion 1 no longer applies, and [ADR 0016](../adr/0016-sync.md) expected one criterion to remain. That holds only if criterion 4 is ruled out for sync, and the guidelines do not rule it out. So sync is treated as meeting two criteria (4 and 7), and a DPIA is required before it processes any data. One [DPIA](dpia.md) covers accounts, the library and sync. It would be kept even on the other reading: it is where these risks are assessed.
