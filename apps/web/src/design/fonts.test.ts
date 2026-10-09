import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const data = new URL("../../../../data/", import.meta.url);
const FONTS = ["font-noto-sans-sc-400", "font-noto-sans-sc-700", "font-lxgw-wenkai-gb"];

type Face = { readonly url: string; readonly ranges: readonly (readonly [number, number])[] };

const faces = (font: string): readonly Face[] =>
  Array.from(
    readFileSync(new URL(`${font}/fonts.css`, data), "utf8").matchAll(/@font-face\s*\{([^}]*)\}/gu),
    ([, body = ""]) => ({
      url: /src:\s*url\("([^"]+)"\)/u.exec(body)?.[1] ?? "",
      ranges: (/unicode-range:\s*([^;]+);/u.exec(body)?.[1] ?? "").split(",").map((range) => {
        const [start = "", end = start] = range.trim().slice(2).split("-");
        return [parseInt(start, 16), parseInt(end, 16)] as const;
      }),
    }),
  );

/** Bytes the browser downloads to render `text` with this font. */
const payload = (font: string, text: string): number => {
  const codePoints = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  return faces(font)
    .filter(({ ranges }) =>
      codePoints.some((codePoint) =>
        ranges.some(([start, end]) => codePoint >= start && codePoint <= end),
      ),
    )
    .reduce((total, { url }) => total + statSync(new URL(`${font}/${url}`, data)).size, 0);
};

const hsk1 = readdirSync(new URL("hsk-2025-chars/", data))
  .filter((name) => name.endsWith(".json"))
  .flatMap(
    (name) =>
      JSON.parse(readFileSync(new URL(`hsk-2025-chars/${name}`, data), "utf8")) as [
        string,
        number,
      ][],
  )
  .filter(([, level]) => level === 1)
  .map(([char]) => char)
  .join("");
const PUNCTUATION = "，。、；：？！“”‘’（）《》…—";
const PINYIN = "abcdefghijklmnopqrstuvwxyzāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü";
const KB = 1024;

describe("self-hosted CJK fonts", () => {
  it("renders an HSK 1 page with at most 72 KB of Noto Sans SC (measured 67 KB)", () => {
    expect(payload("font-noto-sans-sc-400", hsk1 + PUNCTUATION + PINYIN)).toBeLessThanOrEqual(
      72 * KB,
    );
  });

  it("renders the HSK 1 characters with at most 56 KB of LXGW WenKai GB (measured 51 KB)", () => {
    expect(payload("font-lxgw-wenkai-gb", hsk1)).toBeLessThanOrEqual(56 * KB);
  });

  it.each(FONTS)("serves %s from the project origin only", (font) => {
    for (const { url } of faces(font)) expect(url).toMatch(/^\.\/[a-z0-9-]+\.woff2$/u);
  });
});
