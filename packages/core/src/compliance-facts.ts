import type { DatedFact } from "./ai-marking.ts";

/** The one address for users, parents and authorities (DSA arts 11 and 12, Regulation 2021/784 art. 15). */
export const CONTACT_EMAIL = "openlinguo@gmail.com";

/** Status on the official Data Privacy Framework list; `value` is the next certification due date. */
export const DPF_STATUS = {
  cloudflare: {
    value: "2027-09-15",
    source: "https://www.dataprivacyframework.gov/list (Cloudflare, Inc., participant 5666)",
    checkedOn: "2026-10-31",
    reviewBy: "2027-04-30",
  },
  google: {
    value: "2027-09-13",
    source: "https://www.dataprivacyframework.gov/list (Google LLC, participant 5780)",
    checkedOn: "2026-10-31",
    reviewBy: "2027-04-30",
  },
  github: {
    value: "2027-08-03",
    source: "https://www.dataprivacyframework.gov/list (GitHub, participant 6174)",
    checkedOn: "2026-10-31",
    reviewBy: "2027-04-30",
  },
} as const satisfies Readonly<Record<string, DatedFact>>;

/** The processors' agreements and the processing facts the privacy notice relies on. */
export const PROCESSOR_FACTS = {
  cloudflareDpa: {
    value:
      "Customer DPA version 6.4, effective 2026-04-03, part of the Self-Serve Subscription Agreement",
    source: "https://www.cloudflare.com/cloudflare-customer-dpa/",
    checkedOn: "2026-10-31",
    reviewBy: "2027-04-30",
  },
  d1TimeTravelDays: {
    value: 7,
    source: "https://developers.cloudflare.com/d1/reference/time-travel/",
    checkedOn: "2026-10-31",
    reviewBy: "2027-04-30",
  },
  lettermintDpa: {
    value:
      "DPA version of 2026-10-09, part of the Terms and Conditions; email data processed in the EU (section 8.1)",
    source: "https://lettermint.co/dpa",
    checkedOn: "2026-11-01",
    reviewBy: "2027-05-01",
  },
  lettermintRetention: {
    value:
      "content, recipient addresses, metadata and events 28 days after the message; delivery events for analytics at most 90 days",
    source: "https://lettermint.co/dpa (section 3.1)",
    checkedOn: "2026-11-01",
    reviewBy: "2027-05-01",
  },
} as const satisfies Readonly<Record<string, DatedFact>>;

/** GDPR art. 35(11) review of docs/compliance/dpia.md, section 4.3 (#294). */
export const DPIA_REVIEW = {
  value: "docs/compliance/dpia.md",
  source: "docs/compliance/dpia.md#43-decision-and-review",
  checkedOn: "2026-10-31",
  reviewBy: "2027-10-31",
} as const satisfies DatedFact;
