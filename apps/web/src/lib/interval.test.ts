import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatInterval } from "./interval.ts";

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

describe("formatDuration", () => {
  it.each([
    [85_000, "1 min 25 sec"],
    [2 * MINUTE, "2 min"],
    [4_600, "5 sec"],
    [0, "0 sec"],
  ])("%d ms in English", (milliseconds, text) => {
    expect(formatDuration(milliseconds, "en")).toBe(text);
  });

  it("follows the interface language", () => {
    expect(formatDuration(85_000, "fr")).toBe("1\u00a0min 25\u202fs");
  });
});

describe("formatClock", () => {
  it.each([
    [2 * MINUTE, "2:00"],
    [72_000, "1:12"],
    [5_000, "0:05"],
    [400, "0:01"],
    [0, "0:00"],
  ])("%d ms", (milliseconds, text) => {
    expect(formatClock(milliseconds)).toBe(text);
  });
});
