import { describe, expect, it } from "vitest";
import { FINALS, INITIALS, INTERJECTIONS, spell, type PinyinFinal } from "./pinyin-chart.ts";
import { loadCedictRows } from "./testing/dataset-shards.ts";

/** CC-CEDICT syllables the chart leaves out, and why. */
const LEFT_OUT: Readonly<Record<string, string>> = {
  xx: "placeholder for characters without a reading",
  r: "erhua suffix written as its own syllable",
  biang: "biangbiang noodles character and a Taiwanese slang contraction",
  bia: "onomatopoeia",
  biu: "onomatopoeia",
  fiao: "Wu dialect (覅)",
  ging: "loan from Taiwanese Hokkien",
  nun: "one rare literary character (黁)",
};
/** In the 1958 scheme (note 3), absent from CC-CEDICT. */
const NOT_IN_CEDICT = ["ê"];

const COLUMNS: readonly (string | null)[] = [null, ...INITIALS.map(({ letters }) => letters)];

const chart: readonly string[] = [
  ...FINALS.flatMap((pinyinFinal) =>
    COLUMNS.flatMap((initial) => spell(initial, pinyinFinal) ?? []),
  ),
  ...INTERJECTIONS,
];

const finalOf = (letters: string): PinyinFinal => {
  const found = FINALS.find((pinyinFinal) => pinyinFinal.letters === letters);
  if (!found) throw new Error(`no final ${letters}`);
  return found;
};

const cedictSyllables = async (): Promise<ReadonlySet<string>> => {
  const syllables = new Set<string>();
  for (const [, , reading] of await loadCedictRows()) {
    for (const token of reading.split(" ")) {
      const letters = /^([a-z:]+)[1-5]$/iu.exec(token)?.[1];
      if (letters != null) syllables.add(letters.toLowerCase().replace(/u:/gu, "ü"));
    }
  }
  return syllables;
};

describe("syllable chart", () => {
  it("holds every CC-CEDICT syllable, except the ones left out", async () => {
    const cedict = await cedictSyllables();
    const inChart = new Set(chart);
    expect(
      [...cedict].filter((syllable) => !inChart.has(syllable) && !(syllable in LEFT_OUT)),
    ).toEqual([]);
    expect(Object.keys(LEFT_OUT).filter((syllable) => !cedict.has(syllable))).toEqual([]);
  });

  it("holds no syllable CC-CEDICT lacks, except ê", async () => {
    const cedict = await cedictSyllables();
    expect(chart.filter((syllable) => !cedict.has(syllable))).toEqual(NOT_IN_CEDICT);
  });

  it("spells each syllable once", () => {
    expect(new Set(chart).size).toBe(chart.length);
  });

  it("names each initial by a syllable of the chart", () => {
    for (const { letters, reading } of INITIALS) {
      expect(reading.startsWith(letters)).toBe(true);
      expect(chart).toContain(reading);
    }
  });
});

describe("spell", () => {
  it.each([
    [null, "i", "yi"],
    [null, "ia", "ya"],
    [null, "in", "yin"],
    [null, "ing", "ying"],
    [null, "iou", "you"],
    [null, "u", "wu"],
    [null, "uo", "wo"],
    [null, "uei", "wei"],
    [null, "uen", "wen"],
    [null, "ü", "yu"],
    [null, "üan", "yuan"],
    [null, "ê", "ê"],
    [null, "er", "er"],
    ["j", "ü", "ju"],
    ["q", "üe", "que"],
    ["x", "ün", "xun"],
    ["n", "ü", "nü"],
    ["l", "üe", "lüe"],
    ["n", "iou", "niu"],
    ["g", "uei", "gui"],
    ["l", "uen", "lun"],
    ["zh", "-i", "zhi"],
    ["s", "-i", "si"],
    ["b", "o", "bo"],
  ])("%s + %s → %s", (initial, letters, written) => {
    expect(spell(initial, finalOf(letters))).toBe(written);
  });

  it.each([
    ["b", "ia"],
    ["j", "a"],
    [null, "-i"],
    ["d", "ü"],
  ])("%s + %s → no syllable", (initial, letters) => {
    expect(spell(initial, finalOf(letters))).toBeNull();
  });
});
