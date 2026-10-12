import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseArgs } from "node:util";
import { LISTENING_PAGE } from "./bakeoff-page.ts";
import {
  formatReport,
  gradesSchema,
  LABELS,
  makeKey,
  reveal,
  type BakeoffKey,
  type Grades,
} from "./bakeoff-report.ts";
import { BAKEOFF_SET, spokenPinyin } from "./bakeoff-set.ts";
import { ENGINE_IDS, engineInfo, synthesize, type EngineId, type EngineInfo } from "./engines.ts";

const SEED = 1;
const MAX_BODY_BYTES = 1_000_000;
const outDir = new URL("../../../tts/.bakeoff/", import.meta.url);
const samplesDir = new URL("samples/", outDir);
const gradesPath = new URL("grades.json", outDir);
const enginesPath = new URL("engines.json", outDir);
const resultsPath = new URL("../../../tts/bakeoff-results.json", import.meta.url);

class BakeoffError extends Error {}

const samplePath = (item: string, engine: EngineId): URL =>
  new URL(`${item}.${engine}.wav`, samplesDir);

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

const spoken = (id: string): string => {
  const item = BAKEOFF_SET.find((candidate) => candidate.id === id) ?? null;
  const result = item === null ? null : spokenPinyin(item);
  if (result === null || !result.ok) throw new BakeoffError(`no spoken pinyin for ${id}`);
  return result.value;
};

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
    for (const item of BAKEOFF_SET) {
      const path = samplePath(item.id, engine);
      if (await exists(path)) continue;
      const started = Date.now();
      const audio = await synthesize(engine, item.text, SEED);
      if (!audio.ok) throw new BakeoffError(audio.error);
      await writeAtomic(path, audio.value);
      console.log(`${engine} ${item.id} ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  }
};

const missingSamples = async (): Promise<string[]> => {
  const missing: string[] = [];
  for (const item of BAKEOFF_SET) {
    for (const engine of ENGINE_IDS) {
      if (!(await exists(samplePath(item.id, engine)))) missing.push(`${item.id}.${engine}`);
    }
  }
  return missing;
};

const readGrades = async (): Promise<Grades> => {
  if (!(await exists(gradesPath))) return { grades: [], notes: {} };
  const parsed = gradesSchema.safeParse(await readJson(gradesPath));
  if (!parsed.success)
    throw new BakeoffError(`invalid ${gradesPath.pathname}: ${parsed.error.message}`);
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

const handle = async (
  key: BakeoffKey,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
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
      labels: LABELS.filter((label) => key[id]?.[label] != null),
    }));
    send(200, JSON.stringify(items), "application/json");
    return;
  }
  if (request.method === "GET" && path === "/grades") {
    send(200, JSON.stringify(await readGrades()), "application/json");
    return;
  }
  if (request.method === "POST" && path === "/grades") {
    const parsed = gradesSchema.safeParse(JSON.parse(await readBody(request)) as unknown);
    if (!parsed.success) {
      send(400, parsed.error.message, "text/plain; charset=utf-8");
      return;
    }
    await writeAtomic(gradesPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    send(204, "", "text/plain");
    return;
  }
  const [, item = "", label = ""] = /^\/audio\/([\w-]+)\/([A-Z])$/u.exec(path) ?? [];
  const engine = key[item]?.[LABELS.find((candidate) => candidate === label) ?? "A"] ?? null;
  if (request.method === "GET" && engine !== null) {
    send(200, await readFile(samplePath(item, engine)), "audio/wav");
    return;
  }
  send(404, "not found", "text/plain");
};

const serve = async (port: number): Promise<void> => {
  const missing = await missingSamples();
  if (missing.length > 0)
    throw new BakeoffError(`missing samples, run generate first: ${missing.join(", ")}`);
  const key = makeKey(BAKEOFF_SET, ENGINE_IDS);
  const server = createServer((request, response) => {
    handle(key, request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(String(error));
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Listening page: http://127.0.0.1:${String(port)}/ (grades saved to ${gradesPath.pathname})`,
    );
  });
  await new Promise((resolve) => server.on("close", resolve));
};

const report = async (): Promise<void> => {
  const key = makeKey(BAKEOFF_SET, ENGINE_IDS);
  const grades = await readGrades();
  const revealed = reveal(BAKEOFF_SET, key, grades);
  if (!revealed.ok) throw new BakeoffError(revealed.error);
  console.log(formatReport(BAKEOFF_SET, ENGINE_IDS, revealed.value));
  const results = {
    engines: await readEngineInfos(),
    seed: SEED,
    items: BAKEOFF_SET.map(({ id, category, text }) => ({
      id,
      category,
      text,
      spoken: spoken(id),
    })),
    grades: revealed.value,
    notes: grades.notes,
  };
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`Results written to ${resultsPath.pathname}`);
};

const isEngine = (value: string): value is EngineId =>
  (ENGINE_IDS as readonly string[]).includes(value);

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
