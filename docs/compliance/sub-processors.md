# Sub-processors and transfers

None of these is used before M7. Before each goes live, verify its status on the official Data Privacy Framework list at [dataprivacyframework.gov](https://www.dataprivacyframework.gov/) (participants re-certify every year) and sign or accept its data processing agreement. If a US provider is not active on the list, rely on the Standard Contractual Clauses in its agreement.

| Provider | Role | Data | Location | Transfer safeguard | Status |
|---|---|---|---|---|---|
| Cloudflare, Inc. (Pages) | Processor — serves the PWA | IP address, request metadata | Global CDN, US company | DPF (reported active, secondary sources) or SCCs | Verify in M7 |
| Google LLC (OAuth) | Independent controller for its sign-in | Sign-in exchange, only if chosen by the user | US | DPF (reported active, secondary sources) | Verify in M7 |
| GitHub, Inc. (OAuth) | Independent controller for its sign-in | Sign-in exchange, only if chosen by the user | US | Own DPF certification (Microsoft list, last updated 2024-09) | Verify in M7 |
| SMTP provider `[TBD]` | Processor — service emails | Email address, message content | `[TBD]` | `[TBD]` | Choose in M7, prefer EU hosting |

Not sub-processors:

- **The self-hosted API and database server** is operated by the controller itself.
- **The user's AI provider** is chosen and configured by the user (bring your own key); data flows from the device to that provider, never through OpenLinguo. The app shows a notice naming the endpoint before the first call.
- **GitHub (repository hosting)** holds source code, not user data.
