// Records real Wikidata answers for the client tests.
// Usage: pnpm --filter @openlinguo/core record:wikidata
// Sends the sample names of wikidata-recordings.ts, one request after the other, as the Wikimedia
// User-Agent policy asks of a script: its name and a contact, here the repository.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exit } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { lookupWikidata, type WikidataLookup } from "../wikidata.ts";
import type { Exchange } from "./ai-recordings.ts";
import {
  WIKIDATA_SAMPLES,
  WIKIDATA_SCENARIOS,
  wikidataRecordingUrl,
  type WikidataRecording,
  type WikidataScenario,
} from "./wikidata-recordings.ts";

const USER_AGENT = "OpenLinguo-recorder/1.0 (https://github.com/R4z4kk/OpenLinguo)";
const PAUSE_MS = 2_000;

const EXPECTED: Readonly<Record<WikidataScenario, (lookup: WikidataLookup) => boolean>> = {
  found: ({ checked }) =>
    checked.length > 0 && checked.every(({ candidates }) => candidates.length > 0),
  homonyms: ({ checked }) => checked.length === 1 && (checked[0]?.candidates.length ?? 0) >= 10,
  nothing: ({ checked }) =>
    checked.length > 0 && checked.every(({ candidates }) => candidates.length === 0),
};

const parseBody = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return text;
  }
};

const record = async (scenario: WikidataScenario): Promise<boolean> => {
  const exchanges: Exchange[] = [];
  const taping: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", USER_AGENT);
    const response = await fetch(url, { ...init, headers });
    exchanges.push({
      request: {
        method: init?.method ?? "GET",
        path: url.pathname,
        body: { query: url.searchParams.get("query") },
      },
      response: { status: response.status, body: parseBody(await response.clone().text()) },
    });
    return response;
  };
  const lookup = await lookupWikidata({
    sequences: WIKIDATA_SAMPLES[scenario],
    fetch: taping,
    signal: AbortSignal.timeout(120_000),
  });
  const good = lookup.error === null && EXPECTED[scenario](lookup);
  const found = lookup.checked.map(({ candidates }) => candidates.length).join(", ");
  console.log(
    `${good ? "  " : "! "}wikidata/${scenario}: ${lookup.error?.kind ?? "ok"}, candidates per sequence: ${found}`,
  );
  if (!good) return false;
  const recording: WikidataRecording = {
    recordedAt: new Date().toISOString().slice(0, 10),
    scenario,
    exchanges,
  };
  const file = fileURLToPath(wikidataRecordingUrl(scenario));
  mkdirSync(dirname(file), { recursive: true });
  const options = await resolveConfig(file);
  writeFileSync(
    file,
    await format(JSON.stringify(recording, null, 2), { ...(options ?? {}), filepath: file }),
  );
  return true;
};

let failed = false;
for (const scenario of WIKIDATA_SCENARIOS) {
  if (!(await record(scenario))) failed = true;
  await sleep(PAUSE_MS);
}
if (failed) exit(1);
