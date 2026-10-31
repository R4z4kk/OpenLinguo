import { describe, expect, test } from "vitest";
import { CONTACT_EMAIL, DPF_STATUS, DPIA_REVIEW, PROCESSOR_FACTS } from "./compliance-facts.ts";

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

  test("the contact address is filled in before the legal pages ship", () => {
    expect(CONTACT_EMAIL).toMatch(/^[^\s@[\]]+@[^\s@[\]]+\.[a-z]{2,}$/u);
  });
});
