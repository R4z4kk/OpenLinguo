import { err } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex, smallestDeltaE, type Rgb } from "./color.ts";

const hex = (text: string): Rgb => {
  const parsed = parseHex(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

describe("color", () => {
  it("parses #rrggbb and rejects anything else", () => {
    expect(parseHex("#FF0080")).toEqual({ ok: true, value: [1, 0, 128 / 255] });
    expect(parseHex("#F08")).toEqual(err("not a #rrggbb color: #F08"));
  });

  it("gives the WCAG contrast extremes", () => {
    expect(contrastRatio(hex("#000000"), hex("#FFFFFF"))).toBeCloseTo(21, 5);
    expect(contrastRatio(hex("#777777"), hex("#777777"))).toBe(1);
    expect(contrastRatio(hex("#767676"), hex("#FFFFFF"))).toBeCloseTo(4.54, 2);
  });

  it("measures ΔE in CIE Lab and lets protanopia merge red and green", () => {
    const black = hex("#000000");
    const white = hex("#FFFFFF");
    expect(smallestDeltaE([black, white], "normal")).toBeCloseTo(100, 3);
    const redGreen = [hex("#FF0000"), hex("#00FF00")];
    expect(smallestDeltaE(redGreen, "protanopia")).toBeLessThan(
      smallestDeltaE(redGreen, "normal") / 2,
    );
  });
});
