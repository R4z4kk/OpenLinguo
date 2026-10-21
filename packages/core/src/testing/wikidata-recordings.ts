import { readFileSync } from "node:fs";
import { z } from "zod";
import { Exchange } from "./ai-recordings.ts";

export const WIKIDATA_SCENARIOS = ["found", "homonyms", "nothing"] as const;

export type WikidataScenario = (typeof WIKIDATA_SCENARIOS)[number];

/** Well-known names and sample text only: never a learner's text. */
export const WIKIDATA_SAMPLES: Readonly<Record<WikidataScenario, readonly string[]>> = {
  found: ["周杰伦", "张家界"],
  homonyms: ["王芳"],
  nothing: ["王小红"],
};

export const WikidataRecording = z.object({
  recordedAt: z.iso.date(),
  scenario: z.enum(WIKIDATA_SCENARIOS),
  exchanges: z.array(Exchange).min(1),
});

export type WikidataRecording = z.output<typeof WikidataRecording>;

export const wikidataRecordingUrl = (scenario: WikidataScenario): URL =>
  new URL(`./wikidata-responses/${scenario}.json`, import.meta.url);

export const loadWikidataRecording = (scenario: WikidataScenario): WikidataRecording => {
  let text: string;
  try {
    text = readFileSync(wikidataRecordingUrl(scenario), "utf8");
  } catch {
    throw new Error(
      `Missing recording wikidata/${scenario}: run pnpm --filter @openlinguo/core record:wikidata`,
    );
  }
  return WikidataRecording.parse(JSON.parse(text));
};
