import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseArgs } from "node:util";
import { LISTENING_PAGE, MIX_PAGE } from "./bakeoff-page.ts";
import { checkPicks, formatReport, picksSchema, type Picks } from "./bakeoff-report.ts";
import {
  BAKEOFF_SET,
  MIX_CARDS,
  MIX_SENTENCES,
  spokenPinyin,
  type BakeoffItem,
} from "./bakeoff-set.ts";
import { ENGINE_IDS, engineInfo, synthesize, type EngineId, type EngineInfo } from "./engines.ts";
import { decodeWav, encodeWav, joinPcm, trimUtterance, type Pcm } from "./wav.ts";

const SEED = 1;
const MAX_BODY_BYTES = 1_000_000;
const outDir = new URL("../../../tts/.bakeoff/", import.meta.url);
const samplesDir = new URL("samples/", outDir);
const picksPath = new URL("picks.json", outDir);
const enginesPath = new URL("engines.json", outDir);
const resultsPath = new URL("../../../tts/bakeoff-results.json", import.meta.url);

class BakeoffError extends Error {}

const samplePath = (item: string, engine: EngineId): URL =>
  new URL(`${item}.${engine}.wav`, samplesDir);

const isEngine = (value: string): value is EngineId =>
  (ENGINE_IDS as readonly string[]).includes(value);

const exists = async (url: URL): Promise<boolean> => {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (url: URL): Promise<unknown> =>
  JSON.parse(await readFile(url, "utf8")) as unknown;

const writeAtomic = async (url: URL, content: string | Uint8Array): Promise<void> => {
  const temporary = new URL(`${url.href}.tmp`);
  await writeFile(temporary, content);
  await rename(temporary, url);
};

/** GLM-TTS samples from round 1 (revision b3feb69, rejected 2026-10-13), kept on disk for the mix cards only. */
const GLM_SAMPLE_SUFFIX = "glm-tts";
const MIX_PAUSE_SECONDS = 0.6;

const findItem = (id: string): BakeoffItem | null =>
  [...BAKEOFF_SET, ...MIX_SENTENCES].find((candidate) => candidate.id === id) ?? null;

const spoken = (id: string): string => {
  const item = findItem(id);
  const result = item === null ? null : spokenPinyin(item);
  if (result === null || !result.ok) throw new BakeoffError(`no spoken pinyin for ${id}`);
  return result.value;
};

/**
 * MOSS-TTS stops reliably only after punctuation: a final 。 after isolated words (its maintainers' advice,
 * OpenMOSS/MOSS-TTS#19) cut runaway outputs from 7 to 2 of the 36 bake-off items.
 */
const synthesisText = (item: BakeoffItem): string =>
  item.end === "" ? `${item.text}。` : item.text;

const readEngineInfos = async (): Promise<Partial<Record<EngineId, EngineInfo>>> =>
  (await exists(enginesPath))
    ? ((await readJson(enginesPath)) as Partial<Record<EngineId, EngineInfo>>)
    : {};

const generate = async (engines: readonly EngineId[]): Promise<void> => {
  const infos = await readEngineInfos();
  for (const engine of engines) {
    const info = await engineInfo(engine);
    if (!info.ok) throw new BakeoffError(info.error);
    infos[engine] = info.value;
  }
  await mkdir(samplesDir, { recursive: true });
  await writeAtomic(enginesPath, `${JSON.stringify(infos, null, 2)}\n`);
  for (const engine of engines) {
    for (const item of [...BAKEOFF_SET, ...MIX_SENTENCES]) {
      const path = samplePath(item.id, engine);
      if (await exists(path)) continue;
      const started = Date.now();
      const audio = await synthesize(engine, synthesisText(item), SEED);
      if (!audio.ok) throw new BakeoffError(audio.error);
      const pcm = decodeWav(audio.value);
      if (!pcm.ok) throw new BakeoffError(`${engine} ${item.id}: ${pcm.error}`);
      await writeAtomic(path, encodeWav(trimUtterance(pcm.value)));
      console.log(`${engine} ${item.id} ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  }
};

/** Engines with every sample generated, in the fixed display order. */
const completeEngines = async (): Promise<EngineId[]> => {
  const complete: EngineId[] = [];
  for (const engine of ENGINE_IDS) {
    const present = await Promise.all(BAKEOFF_SET.map(({ id }) => exists(samplePath(id, engine))));
    if (present.every(Boolean)) complete.push(engine);
  }
  return complete;
};

const readPicks = async (): Promise<Picks> => {
  if (!(await exists(picksPath))) return { picks: {}, notes: {} };
  const parsed = picksSchema.safeParse(await readJson(picksPath));
  if (!parsed.success) {
    throw new BakeoffError(`invalid ${picksPath.pathname}: ${parsed.error.message}`);
  }
  return parsed.data;
};

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BakeoffError("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });

const readPcm = async (url: URL): Promise<Pcm> => {
  const pcm = decodeWav(new Uint8Array(await readFile(url)));
  if (!pcm.ok) throw new BakeoffError(`${url.pathname}: ${pcm.error}`);
  return pcm.value;
};

/** A mix card as heard: the word (GLM-TTS or MOSS-TTS), a pause, then the MOSS-TTS sentence. */
const mixAudio = async (
  card: (typeof MIX_CARDS)[number],
  wordEngine: "glm" | "moss",
): Promise<Uint8Array> => {
  const word = await readPcm(
    wordEngine === "glm"
      ? new URL(`${card.word}.${GLM_SAMPLE_SUFFIX}.wav`, samplesDir)
      : samplePath(card.word, "moss-tts"),
  );
  const sentence = await readPcm(samplePath(card.sentence, "moss-tts"));
  const joined = joinPcm(trimUtterance(word), sentence, MIX_PAUSE_SECONDS);
  if (!joined.ok) throw new BakeoffError(`${card.word}: ${joined.error}`);
  return encodeWav(joined.value);
};

const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const send = (status: number, body: string | Uint8Array, type: string): void => {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(body);
  };
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && path === "/") {
    send(200, LISTENING_PAGE, "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && path === "/items") {
    const items = BAKEOFF_SET.map(({ id, category, text }) => ({
      id,
      category,
      text,
      spoken: spoken(id),
    }));
    send(200, JSON.stringify({ engines: await completeEngines(), items }), "application/json");
    return;
  }
  if (request.method === "GET" && path === "/mix") {
    send(200, MIX_PAGE, "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && path === "/mix/cards") {
    const cards = MIX_CARDS.map((card) => ({
      word: card.word,
      wordText: findItem(card.word)?.text ?? "",
      wordSpoken: spoken(card.word),
      sentenceText: findItem(card.sentence)?.text ?? "",
      sentenceSpoken: spoken(card.sentence),
    }));
    send(200, JSON.stringify(cards), "application/json");
    return;
  }
  const [, mixWord = "", wordEngine = ""] =
    /^\/mix\/audio\/([\w-]+)\/(glm|moss)$/u.exec(path) ?? [];
  const card = MIX_CARDS.find((candidate) => candidate.word === mixWord) ?? null;
  if (
    request.method === "GET" &&
    card !== null &&
    (wordEngine === "glm" || wordEngine === "moss")
  ) {
    send(200, await mixAudio(card, wordEngine), "audio/wav");
    return;
  }
  if (request.method === "GET" && path === "/picks") {
    send(200, JSON.stringify(await readPicks()), "application/json");
    return;
  }
  if (request.method === "POST" && path === "/picks") {
    const parsed = picksSchema.safeParse(JSON.parse(await readBody(request)) as unknown);
    if (!parsed.success) {
      send(400, parsed.error.message, "text/plain; charset=utf-8");
      return;
    }
    await writeAtomic(picksPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    send(204, "", "text/plain");
    return;
  }
  const [, item = "", engine = ""] = /^\/audio\/([\w-]+)\/([\w-]+)$/u.exec(path) ?? [];
  if (request.method === "GET" && BAKEOFF_SET.some(({ id }) => id === item) && isEngine(engine)) {
    send(200, await readFile(samplePath(item, engine)), "audio/wav");
    return;
  }
  send(404, "not found", "text/plain");
};

const serve = async (port: number): Promise<void> => {
  const complete = await completeEngines();
  if (complete.length === 0)
    throw new BakeoffError("no engine has all its samples, run generate first");
  const pending = ENGINE_IDS.filter((engine) => !complete.includes(engine));
  if (pending.length > 0) console.log(`Not shown until generated: ${pending.join(", ")}`);
  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(String(error));
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Listening page: http://127.0.0.1:${String(port)}/ (picks saved to ${picksPath.pathname})`,
    );
  });
  await new Promise((resolve) => server.on("close", resolve));
};

const report = async (): Promise<void> => {
  const picks = await readPicks();
  const checked = checkPicks(BAKEOFF_SET, picks);
  if (!checked.ok) throw new BakeoffError(checked.error);
  console.log(formatReport(BAKEOFF_SET, ENGINE_IDS, picks));
  const results = {
    engines: await readEngineInfos(),
    seed: SEED,
    items: BAKEOFF_SET.map(({ id, category, text }) => ({
      id,
      category,
      text,
      spoken: spoken(id),
    })),
    picks: picks.picks,
    notes: picks.notes,
  };
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`Results written to ${resultsPath.pathname}`);
};

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    options: {
      engines: { type: "string", default: ENGINE_IDS.join(",") },
      port: { type: "string", default: "8110" },
    },
    allowPositionals: true,
  });
  const engines = values.engines.split(",");
  const unknown = engines.filter((engine) => !isEngine(engine));
  if (unknown.length > 0) throw new BakeoffError(`unknown engine(s): ${unknown.join(", ")}`);
  switch (positionals[0]) {
    case "generate":
      await generate(engines.filter(isEngine));
      return;
    case "serve":
      await serve(Number(values.port));
      return;
    case "report":
      await report();
      return;
    default:
      throw new BakeoffError(
        "usage: bakeoff.ts generate [--engines a,b] | serve [--port n] | report",
      );
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof BakeoffError ? error.message : error);
  process.exitCode = 1;
});
