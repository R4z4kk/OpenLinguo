import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, smallestDeltaE, type Vision } from "./color.ts";
import { colorTokens, type ThemedColor } from "./tokens.ts";

type Theme = "light" | "dark";

const parsed = colorTokens(readFileSync(new URL("../styles.css", import.meta.url), "utf8"));
if (!parsed.ok) throw new Error(parsed.error);
const tokens = parsed.value;

const token = (name: string): ThemedColor => {
  const color = tokens.get(name);
  if (color == null) throw new Error(`styles.css has no --color-${name}`);
  return color;
};

const ratio = (theme: Theme, foreground: string, ground: string): number =>
  contrastRatio(token(foreground)[theme], token(ground)[theme]);

const TONES = ["tone-1", "tone-2", "tone-3", "tone-4"];
const TEXT = ["ink", "muted", "danger"];
const GROUNDS = ["bg", "surface", "sunken"];
const THEMES: readonly Theme[] = ["light", "dark"];

describe("design tokens (docs/design/DESIGN-SYSTEM.md)", () => {
  it.each<readonly [Theme, string, string, number]>([
    ["light", "border-strong", "bg", 3.5],
    ["dark", "border-strong", "surface", 4.3],
    ["light", "ink", "bg", 16.0],
    ["dark", "ink", "bg", 15.9],
    ["light", "on-ink", "ink", 17.2],
    ["dark", "on-ink", "ink", 15.9],
    ["light", "muted", "bg", 6.5],
    ["light", "muted", "sunken", 6.1],
    ["dark", "muted", "surface", 7.2],
    ["light", "danger", "surface", 6.6],
    ["dark", "danger", "surface", 6.6],
    ["light", "tone-1", "surface", 6.6],
    ["light", "tone-2", "surface", 6.8],
    ["light", "tone-3", "surface", 5.3],
    ["light", "tone-4", "surface", 9.7],
    ["light", "tone-neutral", "surface", 5.9],
    ["dark", "tone-1", "bg", 5.3],
    ["dark", "tone-2", "bg", 5.2],
    ["dark", "tone-3", "bg", 11.5],
    ["dark", "tone-4", "bg", 8.7],
    ["dark", "tone-neutral", "bg", 7.8],
  ])("%s %s on %s is %f:1", (theme, foreground, ground, documented) => {
    expect(ratio(theme, foreground, ground)).toBeCloseTo(documented, 1);
  });

  it.each(THEMES)(
    "keeps interface text ≥ 4.5:1 and control borders ≥ 3:1 on every ground (%s)",
    (theme) => {
      for (const ground of GROUNDS) {
        for (const text of TEXT) expect(ratio(theme, text, ground)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(theme, "border-strong", ground)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it.each(THEMES)(
    "keeps tone text ≥ 4.5:1 on bg and surface, the grounds it may sit on (%s)",
    (theme) => {
      for (const ground of ["bg", "surface"]) {
        for (const tone of [...TONES, "tone-neutral"]) {
          expect(ratio(theme, tone, ground)).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each<readonly [Theme, Vision, number]>([
    ["light", "normal", 52.7],
    ["light", "protanopia", 37.5],
    ["light", "deuteranopia", 31.5],
    ["light", "tritanopia", 30.6],
    ["dark", "normal", 54.8],
    ["dark", "protanopia", 38.2],
    ["dark", "deuteranopia", 30.4],
    ["dark", "tritanopia", 32.6],
  ])("separates the %s tones under %s vision by ΔE %f", (theme, vision, documented) => {
    const smallest = smallestDeltaE(
      TONES.map((tone) => token(tone)[theme]),
      vision,
    );
    expect(smallest).toBeCloseTo(documented, 1);
    expect(smallest).toBeGreaterThanOrEqual(30);
  });
});
