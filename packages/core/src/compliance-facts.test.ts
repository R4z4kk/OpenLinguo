import { describe, expect, test } from "vitest";
import {
  CONTACT_EMAIL,
  D1_FREE_DATABASE_SIZE,
  DATA_RETENTION_INJUNCTION,
  DEPLOY_TOKEN,
  DPF_STATUS,
  DPIA_REVIEW,
  LEGAL_WATCH,
  PROCESSOR_FACTS,
} from "./compliance-facts.ts";

const DAY = 24 * 60 * 60_000;

describe("compliance facts", () => {
  test.each([...Object.entries(DPF_STATUS), ...Object.entries(PROCESSOR_FACTS)])(
    "%s was read on its source in the last six months: read it again, update docs/compliance/sub-processors.md, then move checkedOn and reviewBy",
    (_, fact) => {
      expect(Date.now()).toBeLessThan(Date.parse(fact.reviewBy));
      expect(Date.parse(fact.reviewBy) - Date.parse(fact.checkedOn)).toBeLessThanOrEqual(184 * DAY);
    },
  );

  test.each(Object.entries(DPF_STATUS))(
    "%s is reviewed before its certification is due",
    (_, fact) => {
      expect(Date.parse(fact.reviewBy)).toBeLessThan(Date.parse(fact.value));
    },
  );

  test("the DPIA is reviewed within a year: review docs/compliance/dpia.md, then move checkedOn and reviewBy", () => {
    expect(Date.now()).toBeLessThan(Date.parse(DPIA_REVIEW.reviewBy));
    expect(
      Date.parse(DPIA_REVIEW.reviewBy) - Date.parse(DPIA_REVIEW.checkedOn),
    ).toBeLessThanOrEqual(366 * DAY);
  });

  test("the deploy token is renewed a month before it expires: follow docs/compliance/accounts-security.md, then move value, checkedOn and reviewBy", () => {
    expect(Date.now()).toBeLessThan(Date.parse(DEPLOY_TOKEN.reviewBy));
    expect(Date.parse(DEPLOY_TOKEN.reviewBy)).toBeLessThan(Date.parse(DEPLOY_TOKEN.value));
    expect(Date.parse(DEPLOY_TOKEN.value) - Date.parse(DEPLOY_TOKEN.checkedOn)).toBeLessThanOrEqual(
      366 * DAY,
    );
  });

  test("the data retention injunction is read again a month before it ends: find the décret that renews it, update docs/compliance/dpia.md, then move value, source, checkedOn and reviewBy", () => {
    expect(Date.now()).toBeLessThan(Date.parse(DATA_RETENTION_INJUNCTION.reviewBy));
    expect(Date.parse(DATA_RETENTION_INJUNCTION.reviewBy)).toBeLessThan(
      Date.parse(DATA_RETENTION_INJUNCTION.value),
    );
    expect(
      Date.parse(DATA_RETENTION_INJUNCTION.value) - Date.parse(DATA_RETENTION_INJUNCTION.checkedOn),
    ).toBeLessThanOrEqual(366 * DAY);
  });

  test.each(Object.entries(LEGAL_WATCH))(
    "%s is read again on its source in the last six months: re-read it, update docs/ROADMAP.md (Privacy & compliance, accessibility) and the statement in apps/web/src/legal/accessibility.tsx, then move value, checkedOn and reviewBy",
    (_, fact) => {
      expect(Date.now()).toBeLessThan(Date.parse(fact.reviewBy));
      expect(Date.parse(fact.reviewBy) - Date.parse(fact.checkedOn)).toBeLessThanOrEqual(184 * DAY);
    },
  );

  test("the D1 size limit is read again within a year: check the D1 limits page, then move checkedOn and reviewBy", () => {
    expect(Date.now()).toBeLessThan(Date.parse(D1_FREE_DATABASE_SIZE.reviewBy));
    expect(
      Date.parse(D1_FREE_DATABASE_SIZE.reviewBy) - Date.parse(D1_FREE_DATABASE_SIZE.checkedOn),
    ).toBeLessThanOrEqual(366 * DAY);
  });

  test("the contact address is filled in before the legal pages ship", () => {
    expect(CONTACT_EMAIL).toMatch(/^[^\s@[\]]+@[^\s@[\]]+\.[a-z]{2,}$/u);
  });
});
