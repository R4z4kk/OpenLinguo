import { describe, expect, it } from "vitest";
import { formatInterval } from "./interval.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("formatInterval", () => {
  it.each([
    [10 * MINUTE, "10 min"],
    [20_000, "1 min"],
    [5 * 60 * MINUTE, "5 hr"],
    [3 * DAY, "3 days"],
    [45 * DAY, "1.5 mths"],
    [730 * DAY, "2 yrs"],
  ])("%d ms in English", (milliseconds, text) => {
    expect(formatInterval(milliseconds, "en")).toBe(text);
  });

  it("follows the interface language", () => {
    expect(formatInterval(3 * DAY, "fr")).toBe("3\u202fj");
  });
});
