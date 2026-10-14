import { readdir } from "node:fs/promises";
import {
  ACCURACY_FLOOR,
  CONFIDENT_ACCURACY_FLOOR,
  CONFIDENT_COVERAGE_FLOOR,
  leaveOneSpeakerOut,
  TONE_MODEL,
  trainToneModel,
} from "@openlinguo/core";
import { beforeAll, describe, expect, it } from "vitest";
import { fixturesDir, loadFixtures, type Fixture } from "./fixtures.ts";

let fixtures: readonly Fixture[] = [];

/** 289 recordings decoded and analysed: slower under coverage on a shared CI worker. */
beforeAll(async () => {
  fixtures = await loadFixtures();
}, 60_000);

describe("tone fixtures", () => {
  it("are human recordings of several speakers of both genders, every tone well covered", () => {
    expect(new Set(fixtures.map(({ speaker }) => speaker)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(fixtures.map(({ gender }) => gender))).toEqual(new Set(["female", "male"]));
    for (const tone of [1, 2, 3, 4]) {
      expect(fixtures.filter((fixture) => fixture.tone === tone).length).toBeGreaterThanOrEqual(50);
    }
  });

  it("each have a CC0 option on their Commons page, and every file is listed", async () => {
    for (const { file, offered, commons } of fixtures) {
      expect(offered, file).toMatch(/(^|\+)(cc-0|cc-zero)(\+|$)/u);
      expect(new URL(commons).host, file).toBe("commons.wikimedia.org");
    }
    const onDisk = (await readdir(fixturesDir)).filter((name) => name.endsWith(".wav")).sort();
    expect(onDisk).toEqual(fixtures.map(({ file }) => file).sort());
  });

  it("tell the tone of a speaker the model never heard, above the measured floors", () => {
    const rates = leaveOneSpeakerOut(fixtures);
    expect(rates.ok).toBe(true);
    if (!rates.ok) return;
    expect(rates.value.accuracy).toBeGreaterThanOrEqual(ACCURACY_FLOOR);
    expect(rates.value.coverage).toBeGreaterThanOrEqual(CONFIDENT_COVERAGE_FLOOR);
    expect(rates.value.confidentAccuracy).toBeGreaterThanOrEqual(CONFIDENT_ACCURACY_FLOOR);
  });

  it("match the shipped model (run `pnpm --filter @openlinguo/data-pipeline tone-model`)", () => {
    const model = trainToneModel(fixtures);
    expect(model.ok && model.value).toEqual(TONE_MODEL);
  });
});
