# Compliance

Baseline written in M0 (issue #10) so privacy and accessibility are designed in, not retrofitted. These are working documents, not legal advice. The legal basis behind them is in the roadmap's compliance table and [ADR 0009](../adr/0009-privacy-and-compliance.md).

Values in `[BRACKETS]` are filled in M7, when the server and accounts go live.

| Document | Purpose |
|---|---|
| [Data map](data-map.md) | What data exists, where it lives, who can see it |
| [Records of processing](records-of-processing.md) | GDPR art. 30(1) register |
| [Retention schedule](retention-schedule.md) | How long each category is kept |
| [Sub-processors](sub-processors.md) | Third parties that process personal data, and transfers |
| [Breach procedure](breach-procedure.md) | GDPR art. 33–34 response and internal register |
| [DPIA screening](dpia-screening.md) | Whether a data protection impact assessment is required |
| [Accessibility statement template](accessibility-statement-template.md) | Published at v1 |

Every pull request goes through the privacy and accessibility checklist in [`.github/pull_request_template.md`](../../.github/pull_request_template.md).

## Review triggers

Update these documents in the same pull request when a change:

- stores or transmits a new category of personal data;
- adds a third party that receives personal data, or a runtime request to a third-party origin;
- changes a retention period or a legal basis;
- affects minors, leagues, AI features or voice processing.
