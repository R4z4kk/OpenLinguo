# DPIA screening

Screening against the nine criteria of the Article 29 Working Party guidelines on DPIA ([WP248 rev.01](https://ec.europa.eu/newsroom/just/document.cfm?doc_id=47711), endorsed by the EDPB on 2018-05-25). In most cases, "a processing meeting two criteria would require a DPIA". Neither CNIL list matches: processing that requires a DPIA ([délibération 2018-327](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000037559521)) or that is exempted ([délibération 2019-118](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000039248939)). Checked 2026-10-31.

| # | Criterion | Applies? | Reasoning |
|---|---|---|---|
| 1 | Evaluation or scoring | **Yes, from M8** | Leagues rank learners by XP. In M7 the level estimate scores texts, not people, and progress statistics stay on the device |
| 2 | Automated decision with legal or similar significant effect | No | Scheduling and rankings have no legal or similar effect; plausibility caps never exclude anyone automatically |
| 3 | Systematic monitoring | No | No tracking; review logs are synced only on opt-in |
| 4 | Sensitive or highly personal data | No on the server | Voice is processed on the device only and never uploaded |
| 5 | Large scale | No, for now | Small open-source project; reassess if accounts grow significantly |
| 6 | Matching or combining datasets | No | No data enrichment or cross-referencing |
| 7 | Vulnerable data subjects | **Yes** | Accounts open to 15–17-year-olds |
| 8 | Innovative use of technology | No on the server | Speech runs on the device. The AI features (M5) use generative models, a new technology, but the requests go from the learner's device to the provider they chose, and OpenLinguo is most likely not a controller of them ([AI features](ai.md#12-gdpr-most-likely-not-a-controller-of-the-ai-calls)); art. 35 binds controllers. Reassess if OpenLinguo adds a relay, a shared key or server-side AI |
| 9 | Prevents exercising a right or using a service | No | The app works fully without an account |

## Conclusion

M7 (accounts, shared library) meets one criterion (7): a DPIA is not mandatory for it. The M8 leagues add criterion 1, so a DPIA is required before they process any data. One [DPIA](dpia.md) covers both, written in M7 (#280): accounts and library validated, leagues to be completed with their real design before they open (#296).
