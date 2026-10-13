import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { dataDir } from "../manifest.ts";
import { BAKEOFF_SET, MIX_CARDS, MIX_SENTENCES, spokenPinyin } from "./bakeoff-set.ts";

type CedictRow = readonly [simplified: string, traditional: string, reading: string];

const cedictReadings = async (): Promise<ReadonlySet<string>> => {
  const dir = new URL("cc-cedict/", dataDir);
  const names = (await readdir(dir)).filter((name) => name.startsWith("entries-"));
  const shards = await Promise.all(names.map((name) => readFile(new URL(name, dir), "utf8")));
  return new Set(
    shards.flatMap((shard) =>
      (JSON.parse(shard) as CedictRow[]).map(
        ([simplified, , reading]) => `${simplified}\t${reading}`,
      ),
    ),
  );
};

const spoken = (id: string): string => {
  const item = BAKEOFF_SET.find((candidate) => candidate.id === id) ?? null;
  if (item === null) throw new Error(`no item ${id}`);
  const result = spokenPinyin(item);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

describe("TTS bake-off set", () => {
  it("has 36 items with unique ids", () => {
    expect(BAKEOFF_SET).toHaveLength(36);
    expect(new Set(BAKEOFF_SET.map(({ id }) => id)).size).toBe(36);
  });

  it("uses CC-CEDICT readings only", async () => {
    const readings = await cedictReadings();
    const missing = [...BAKEOFF_SET, ...MIX_SENTENCES]
      .flatMap(({ words }) => words)
      .map(({ text, reading }) => `${text}\t${reading}`)
      .filter((key) => !readings.has(key));
    expect(missing).toEqual([]);
  }, 30_000);

  it("gives the spoken tones after sandhi", () => {
    expect(spoken("nihao")).toBe("níhǎo");
    expect(spoken("zhanlanguan")).toBe("zhánlánguǎn");
    expect(spoken("wo-hen-hao")).toBe("wǒ hén hǎo");
    expect(spoken("xiao-laohu")).toBe("xiǎo láohǔ");
    expect(spoken("yige")).toBe("yíge");
    expect(spoken("yi-tian")).toBe("yì tiān");
    expect(spoken("diyi")).toBe("dìyī");
    expect(spoken("bushi")).toBe("búshì");
    expect(spoken("buhao")).toBe("bùhǎo");
  });

  it("pairs each mix card's word with a sentence that contains it", () => {
    const items = new Map([...BAKEOFF_SET, ...MIX_SENTENCES].map((item) => [item.id, item]));
    for (const card of MIX_CARDS) {
      const word = items.get(card.word) ?? null;
      const sentence = items.get(card.sentence) ?? null;
      expect(word !== null && sentence !== null && sentence.text.includes(word.text)).toBe(true);
    }
  });

  it("converts every item", () => {
    expect(BAKEOFF_SET.filter((item) => !spokenPinyin(item).ok).map(({ id }) => id)).toEqual([]);
  });
});
