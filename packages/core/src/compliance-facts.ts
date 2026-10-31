import type { DatedFact } from "./ai-marking.ts";

/** The one address for users, parents and authorities (DSA arts 11 and 12, Regulation 2021/784 art. 15). */
export const CONTACT_EMAIL = "[CONTACT_EMAIL]";

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
  scalewayDpa: {
    value: "Data Processing Agreement, version of 2024-06-01, integral part of the contract",
    source: "https://www.scaleway.com/en/contracts/",
    checkedOn: "2026-10-31",
    reviewBy: "2027-04-30",
  },
  /** Scaleway says it plans to shorten this in 2027. */
  scalewaySendingLogs: {
    value: "kept as long as the sending domain is active; mail content deleted once accepted",
    source: "https://www.scaleway.com/en/docs/transactional-email/reference-content/data-privacy/",
    checkedOn: "2026-10-31",
    reviewBy: "2027-04-30",
  },
} as const satisfies Readonly<Record<string, DatedFact>>;

/** GDPR art. 35(11) review of docs/compliance/dpia.md, section 4.3 (#294). */
export const DPIA_REVIEW = {
  value: "docs/compliance/dpia.md",
  source: "docs/compliance/dpia.md#43-decision-and-review",
  checkedOn: "2026-10-31",
  reviewBy: "2027-10-31",
} as const satisfies DatedFact;
