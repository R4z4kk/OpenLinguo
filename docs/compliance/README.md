# Compliance

Baseline written in M0 (issue #10) so privacy and accessibility are designed in, not retrofitted. These are working documents, not legal advice. The legal basis behind them is in the roadmap's compliance table and [ADR 0009](../adr/0009-privacy-and-compliance.md).

Values that can expire (Data Privacy Framework statuses, processor agreements, the DPIA review, the code of practice facts) are dated in `packages/core/src/compliance-facts.ts` and `ai-marking.ts`, with `checkedOn`, `reviewBy` and their source; a unit test fails from each `reviewBy`.

| Document | Purpose |
|---|---|
| [Data map](data-map.md) | What data exists, where it lives, who can see it |
| [Records of processing](records-of-processing.md) | GDPR art. 30(1) register |
| [Retention schedule](retention-schedule.md) | How long each category is kept |
| [Sub-processors](sub-processors.md) | Third parties that process personal data, and transfers |
| [Breach procedure](breach-procedure.md) | GDPR art. 33–34 response and internal register |
| [DPIA screening](dpia-screening.md) | Whether a data protection impact assessment is required |
| [DPIA](dpia.md) | Impact assessment of accounts, the shared library, the décret 2021-1362 retention and the M8 leagues (CNIL PIA method), with its action plan |
| [AI features](ai.md) | Roles, AI Act art. 50 per output, gap analysis against the code of practice, provenance specification |
| [Moderation runbook](moderation.md) | Checklist, notices, PHAROS reports, 24-hour and 1-hour removal orders |
| [Requests runbook](requests.md) | Rights requests, parents' requests to delete a child's account, authorities' requisitions, and the access register |
| [Wikidata lookup](wikidata.md) | What the lookup sends to the Wikimedia Foundation, roles, the U.S. transfer, the dated endpoint |
| [Privacy notice](privacy-notice.md) | Where the public legal pages live: `/legal`, `/privacy`, `/terms` |
| [Accessibility statement template](accessibility-statement-template.md) | Published at v1 |

Every pull request goes through the privacy and accessibility checklist in [`.github/pull_request_template.md`](../../.github/pull_request_template.md).

## Review triggers

Update these documents in the same pull request when a change:

- stores or transmits a new category of personal data;
- adds a third party that receives personal data, or a runtime request to a third-party origin;
- changes a retention period or a legal basis;
- affects minors, leagues, AI features or voice processing.
