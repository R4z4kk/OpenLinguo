import { describe, expect, it } from "vitest";
import {
  CONTOUR_POINTS,
  pitchDistance,
  pitchLimits,
  rankSources,
  syllableOf,
  templateShape,
  toneOf,
  toneTemplates,
  transferSeconds,
  transferSources,
  usableSource,
  type ToneTemplates,
} from "./tone-transfer.ts";

const flat = (semitones: number): number[] => Array<number>(CONTOUR_POINTS).fill(semitones);
const ramp = (from: number, to: number): number[] =>
  Array.from(
    { length: CONTOUR_POINTS },
    (_, at) => from + ((to - from) * at) / (CONTOUR_POINTS - 1),
  );

const templates: ToneTemplates = {
  1: { contour: flat(15), seconds: 0.4 },
  2: { contour: ramp(10, 14), seconds: 0.45 },
  3: { contour: flat(7), seconds: 0.5 },
  4: { contour: ramp(16, 8), seconds: 0.3 },
};

describe("reading keys", () => {
  it("splits a reading key into its syllable and tone", () => {
    expect(syllableOf("lu:4")).toBe("lu:");
    expect(toneOf("lu:4")).toBe(4);
    expect(toneOf("ma5")).toBeNull();
    expect(syllableOf("ma5")).toBe("ma");
  });
});

describe("toneTemplates", () => {
  it("averages each tone's contours point by point and keeps the median duration", () => {
    const result = toneTemplates([
      { tone: 1, analysis: { seconds: 0.3, contour: flat(14) } },
      { tone: 1, analysis: { seconds: 0.5, contour: flat(16) } },
      { tone: 1, analysis: { seconds: 0.4, contour: flat(15) } },
      { tone: 2, analysis: { seconds: 0.45, contour: ramp(10, 14) } },
      { tone: 3, analysis: { seconds: 0.5, contour: flat(7) } },
      { tone: 4, analysis: { seconds: 0.3, contour: ramp(16, 8) } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[1].contour).toEqual(flat(15));
    expect(result.value[1].seconds).toBe(0.4);
    expect(result.value[4].contour[0]).toBe(16);
  });

  it("fails when a tone has no recording", () => {
    const result = toneTemplates([{ tone: 1, analysis: { seconds: 0.4, contour: flat(15) } }]);
    expect(result).toEqual({ ok: false, error: { kind: "missing-tone", tone: 2 } });
  });
});

describe("transferSeconds", () => {
  it("keeps how long the source is for its own tone", () => {
    expect(transferSeconds(templates, 1, 0.48, 3)).toBeCloseTo(0.6);
    expect(transferSeconds(templates, 3, 0.5, 4)).toBeCloseTo(0.3);
  });
});

describe("usableSource", () => {
  it("leaves out a voiced stretch under half or over twice its tone's usual length", () => {
    expect(usableSource({ seconds: 0.4, contour: flat(15) }, 1, templates)).toBe(true);
    expect(usableSource({ seconds: 0.21, contour: flat(15) }, 1, templates)).toBe(true);
    expect(usableSource({ seconds: 0.19, contour: flat(15) }, 1, templates)).toBe(false);
    expect(usableSource({ seconds: 0.81, contour: flat(15) }, 1, templates)).toBe(false);
  });
});

describe("templateShape", () => {
  it("gives the app's ten points in tenths of a semitone around the median", () => {
    expect(templateShape(templates[1])).toEqual(Array<number>(10).fill(0));
    const falling = templateShape(templates[4]);
    expect(falling).toHaveLength(10);
    expect(falling[0]).toBeGreaterThan(30);
    expect(falling[9]).toBeLessThan(-30);
  });
});

describe("pitchDistance", () => {
  it("is zero for the template's own shape, whatever the register", () => {
    const shape = templateShape(templates[4]);
    expect(pitchDistance(shape, templates[4])).toBeCloseTo(0);
    expect(
      pitchDistance(
        shape.map((point) => point + 50),
        templates[4],
      ),
    ).toBeCloseTo(0);
  });

  it("measures in semitones over the voiced points only", () => {
    const shape = templateShape(templates[1]);
    const bent = shape.map((point, at) => (at < 5 ? point + 10 : point - 10));
    expect(pitchDistance(bent, templates[1])).toBeCloseTo(1);
    const holed = [null, null, null, null, ...shape.slice(4)];
    expect(pitchDistance(holed, templates[1])).toBeCloseTo(0);
  });

  it("does not judge a contour with fewer than half its points voiced", () => {
    const shape = templateShape(templates[1]);
    expect(pitchDistance([...Array<null>(6).fill(null), ...shape.slice(6)], templates[1])).toBe(
      null,
    );
  });
});

describe("pitchLimits", () => {
  it("takes, for each tone, the distance under which the given share of recordings fall", () => {
    const shape = templateShape(templates[1]);
    const recordings = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((step) => ({
      tone: 1 as const,
      contour: shape.map((point, at) => (at < 5 ? point + step : point - step)),
    }));
    const limits = pitchLimits(recordings, templates, 0.9);
    expect(limits[1]).toBeCloseTo(0.8);
    expect(limits[2]).toBe(0);
  });
});

describe("rankSources", () => {
  it("prefers shipped recordings, then tones 3, 2, 1 and 4, then seeds", () => {
    const ranked = rankSources([
      { key: "种\tzhong4", reading: "zhong4", kind: "shipped" },
      { key: "钟\tzhong1", reading: "zhong1", kind: "shipped" },
      { key: "肿\tzhong3", reading: "zhong3", kind: "tone-doubted" },
      { key: "中\tzhong1", reading: "zhong1", kind: "seed" },
      { key: "冢\tzhong3", reading: "zhong3", kind: "shipped" },
    ]);
    expect(ranked.map(({ key }) => key)).toEqual([
      "冢\tzhong3",
      "钟\tzhong1",
      "种\tzhong4",
      "肿\tzhong3",
      "中\tzhong1",
    ]);
  });
});

describe("transferSources", () => {
  const heard = (reading: string, transcript: string): boolean =>
    ({ zhong: "中钟种肿", a: "啊" })[reading.slice(0, -1)]?.includes(transcript) === true;

  it("keeps one-syllable recordings whose syllable was heard, by syllable, with their kind", () => {
    const sources = transferSources({
      recordings: [
        ["钟\tzhong1", { transcript: "中", pass: true }],
        ["肿\tzhong3", { transcript: "种", pass: false }],
        ["冢\tzhong3", { transcript: "宗", pass: false }],
        ["忠\tzhong1", { transcript: "终", pass: false }],
        ["啊\ta1", { transcript: "啊", pass: true }],
        ["中国\tzhong1 guo2", { transcript: "中国", pass: true }],
        ["吗\tma5", { transcript: "吗", pass: true }],
        ["种\tzhong4", { transcript: null, pass: null }],
      ],
      seeds: new Set(["啊\ta1"]),
      reviews: { "忠\tzhong1": "ok" },
      heard,
    });
    expect(sources.get("zhong")).toEqual([
      { key: "钟\tzhong1", reading: "zhong1", kind: "shipped" },
      { key: "肿\tzhong3", reading: "zhong3", kind: "tone-doubted" },
      { key: "忠\tzhong1", reading: "zhong1", kind: "shipped" },
    ]);
    expect(sources.get("a")).toEqual([{ key: "啊\ta1", reading: "a1", kind: "seed" }]);
    expect(sources.has("ma")).toBe(false);
  });

  it("never uses a recording rejected by ear", () => {
    const sources = transferSources({
      recordings: [["钟\tzhong1", { transcript: "中", pass: true }]],
      seeds: new Set(),
      reviews: { "钟\tzhong1": "bad" },
      heard,
    });
    expect(sources.size).toBe(0);
  });
});
