import { describe, expect, test } from "vitest";
import { MARKING_FACTS, UPSTREAM_WATERMARK } from "./ai-marking.ts";

const DAY = 24 * 60 * 60_000;

describe("art. 50(2) marking facts", () => {
  test.each([...Object.entries(MARKING_FACTS), ...Object.entries(UPSTREAM_WATERMARK)])(
    "%s was read on its source in the last six months: read it again, update docs/compliance/ai.md §3.1, then move checkedOn and reviewBy",
    (_, fact) => {
      expect(Date.now()).toBeLessThan(Date.parse(fact.reviewBy));
      expect(Date.parse(fact.reviewBy) - Date.parse(fact.checkedOn)).toBeLessThanOrEqual(184 * DAY);
    },
  );
});
