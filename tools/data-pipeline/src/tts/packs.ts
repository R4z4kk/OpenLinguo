import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { contour, F0_VERSION, type Result } from "@openlinguo/core";
import { z } from "zod";
import { dataDir, manifestPath, readManifest, serializeManifest } from "../manifest.ts";
import { loadCharSyllables, transcriptMatches, type CharSyllables } from "./asr-check.ts";
import { asrInfo, transcribe } from "./asr.ts";
import { spokenPinyin } from "./bakeoff-set.ts";
import { engineInfo, synthesize } from "./engines.ts";
import { AUDIO_DATASET, packIndexPath, packIndexSchema, type PackIndex } from "./pack-index.ts";
import { REVIEW_PAGE } from "./pack-review-page.ts";
import {
  bandItems,
  isReferential,
  itemKey,
  loadWordLists,
  REFERENTIALS,
  severalReadings,
  syllableCount,
  type Band,
  type Gap,
  type PackItem,
} from "./pack-words.ts";
import { decodeWav, encodeWav, trimUtterance } from "./wav.ts";
import { storedZip } from "./zip.ts";

const run = promisify(execFile);

/** Seeds tried before a recording that fails the check goes to human review. */
const SEEDS = [1, 2, 3] as const;
/** Pages serves files up to 25 MiB (developers.cloudflare.com/pages/platform/limits, checked 2026-10-14). */
const PART_BYTES = 20 * 1024 * 1024;
const MP3_BITRATE = "48k";
/** Bump for every rebuild: release assets are immutable once the app points to them. */
const RELEASE = "audio-zh-1";
const RELEASE_URL = `https://github.com/R4z4kk/OpenLinguo/releases/tag/${RELEASE}`;
const SERVICE_TIMEOUT_MS = 20 * 60_000;
const SAVE_EVERY = 50;
const MAX_BODY_BYTES = 10_000_000;

const workDir = new URL("../../../tts/.packs/", import.meta.url);
const wavDir = new URL("wav/", workDir);
const mp3Dir = new URL("mp3/", workDir);
const outDir = new URL("out/", workDir);
const statePath = new URL("state.json", workDir);
const reviewsPath = new URL("reviews.json", workDir);
const composeFile = fileURLToPath(new URL("../../../tts/compose.yaml", import.meta.url));
const voicePath = new URL("../../../tts/voices/designed-zh-female.wav", import.meta.url);
const gapsPath = new URL("gaps/audio-zh.tsv", dataDir);

class PacksError extends Error {}

const itemStateSchema = z.strictObject({
  seed: z.number().int().positive(),
  transcript: z.string().nullable(),
  pass: z.boolean().nullable(),
});
const stateSchema = z.strictObject({
  tts: z.string(),
  voiceSha256: z.string(),
  asr: z.string().nullable(),
  items: z.record(z.string(), itemStateSchema),
});
type State = z.infer<typeof stateSchema>;
const reviewsSchema = z.record(z.string(), z.enum(["ok", "bad"]));

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const fileId = (item: PackItem): string => sha256(itemKey(item)).slice(0, 16);
const wavPath = (item: PackItem): URL => new URL(`${fileId(item)}.wav`, wavDir);

const exists = async (url: URL): Promise<boolean> => {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
};

const writeAtomic = async (url: URL, content: string | Uint8Array): Promise<void> => {
  const temporary = new URL(`${url.href}.tmp`);
  await writeFile(temporary, content);
  await rename(temporary, url);
};

const readParsed = async <T>(url: URL, schema: z.ZodType<T>, fallback: T): Promise<T> => {
  if (!(await exists(url))) return fallback;
  const parsed = schema.safeParse(JSON.parse(await readFile(url, "utf8")) as unknown);
  if (!parsed.success) throw new PacksError(`invalid ${url.pathname}: ${parsed.error.message}`);
  return parsed.data;
};

const saveState = (state: State): Promise<void> =>
  writeAtomic(statePath, `${JSON.stringify(state)}\n`);

const compose = async (...args: string[]): Promise<string> => {
  try {
    return (await run("docker", ["compose", "-f", composeFile, ...args])).stdout;
  } catch (error) {
    throw new PacksError(`docker compose ${args.join(" ")} failed: ${String(error)}`);
  }
};

/** Starts a service of tools/tts/compose.yaml and waits for its /health; the GPU holds one model at a time. */
const startService = async <T>(
  service: string,
  health: () => Promise<Result<T, string>>,
): Promise<T> => {
  // The images are built locally (tools/tts), never pulled from a registry.
  await compose("up", "-d", "--pull", "never", service);
  const deadline = Date.now() + SERVICE_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const info = await health();
    if (info.ok) return info.value;
    last = info.error;
    if ((await compose("ps", "-q", "--status", "running", service)).trim() === "") {
      throw new PacksError(
        `${service} stopped, see: docker compose -f ${composeFile} logs ${service}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new PacksError(
    `${service} is not healthy after ${String(SERVICE_TIMEOUT_MS / 60_000)} min: ${last}`,
  );
};

const parseBand = (value: string): Band => {
  const [referential = "", level = ""] = value.split(":");
  const number = Number(level);
  if (!isReferential(referential) || !Number.isInteger(number) || number < 1 || number > 7) {
    throw new PacksError(
      `invalid band ${value}: expected ${Object.keys(REFERENTIALS).join(" or ")}:1-7`,
    );
  }
  return { referential, level: number };
};

const loadBands = async (
  bands: readonly Band[],
): Promise<
  { readonly band: Band; readonly items: readonly PackItem[]; readonly gaps: readonly Gap[] }[]
> => {
  const lists = await loadWordLists();
  const excluded = severalReadings(lists);
  return bands.map((band) => ({ band, ...bandItems(lists, band, excluded) }));
};

const unique = (items: readonly PackItem[]): PackItem[] => [
  ...new Map(items.map((item) => [itemKey(item), item])).values(),
];

const loadState = async (): Promise<State> => {
  const voiceSha256 = sha256(await readFile(voicePath));
  const state = await readParsed(statePath, stateSchema, {
    tts: "",
    voiceSha256,
    asr: null,
    items: {},
  });
  if (state.voiceSha256 !== voiceSha256) {
    throw new PacksError(
      `${statePath.pathname} was built with another voice: move it away to start over`,
    );
  }
  return state;
};

const generate = async (items: readonly PackItem[], state: State, seed: number): Promise<void> => {
  const reviews = await readParsed(reviewsPath, reviewsSchema, {});
  const todo = items.filter((item) => {
    const saved = state.items[itemKey(item)] ?? null;
    if (saved === null) return true;
    return saved.pass === false && saved.seed < seed && !(itemKey(item) in reviews);
  });
  if (todo.length === 0) return;
  const info = await startService("moss-tts", () => engineInfo("moss-tts"));
  const tts = `${info.model}@${info.revision}`;
  if (state.tts !== "" && state.tts !== tts) {
    throw new PacksError(
      `${statePath.pathname} was built with ${state.tts}, not ${tts}: move it away to start over`,
    );
  }
  state.tts = tts;
  await mkdir(wavDir, { recursive: true });
  for (const [index, item] of todo.entries()) {
    // A final 。 makes MOSS-TTS stop after an isolated word (ADR 0007).
    const audio = await synthesize("moss-tts", `${item.word}。`, seed);
    if (!audio.ok) throw new PacksError(audio.error);
    const pcm = decodeWav(audio.value);
    if (!pcm.ok) throw new PacksError(`${item.word}: ${pcm.error}`);
    await writeAtomic(wavPath(item), encodeWav(trimUtterance(pcm.value)));
    state.items[itemKey(item)] = { seed, transcript: null, pass: null };
    if ((index + 1) % SAVE_EVERY === 0 || index === todo.length - 1) {
      await saveState(state);
      console.log(`moss-tts seed ${String(seed)}: ${String(index + 1)} of ${String(todo.length)}`);
    }
  }
  await compose("stop", "moss-tts");
};

const check = async (
  items: readonly PackItem[],
  state: State,
  chars: CharSyllables,
): Promise<void> => {
  const todo = items.filter((item) => state.items[itemKey(item)]?.pass === null);
  if (todo.length === 0) return;
  const info = await startService("qwen3-asr", asrInfo);
  const asr = `${info.model}@${info.revision}`;
  if (state.asr !== null && state.asr !== asr) {
    throw new PacksError(
      `${statePath.pathname} was checked with ${state.asr}, not ${asr}: move it away to start over`,
    );
  }
  state.asr = asr;
  for (const [index, item] of todo.entries()) {
    const text = await transcribe(new Uint8Array(await readFile(wavPath(item))));
    if (!text.ok) throw new PacksError(`${item.word}: ${text.error}`);
    const saved = state.items[itemKey(item)] ?? null;
    if (saved === null) throw new PacksError(`${item.word} has no recording`);
    state.items[itemKey(item)] = {
      ...saved,
      transcript: text.value,
      pass: transcriptMatches(chars, item.reading, text.value),
    };
    if ((index + 1) % SAVE_EVERY === 0 || index === todo.length - 1) {
      await saveState(state);
      console.log(`qwen3-asr: ${String(index + 1)} of ${String(todo.length)}`);
    }
  }
  await compose("stop", "qwen3-asr");
};

const build = async (bands: readonly Band[]): Promise<void> => {
  const items = unique((await loadBands(bands)).flatMap(({ items: bandOnes }) => bandOnes));
  const state = await loadState();
  const chars = await loadCharSyllables();
  await mkdir(workDir, { recursive: true });
  for (const seed of SEEDS) {
    await generate(items, state, seed);
    await check(items, state, chars);
  }
  const reviews = await readParsed(reviewsPath, reviewsSchema, {});
  const failing = items.filter((item) => state.items[itemKey(item)]?.pass === false);
  const unreviewed = failing.filter((item) => !(itemKey(item) in reviews));
  console.log(
    `${String(items.length)} recordings, ${String(items.length - failing.length)} pass the check, ${String(failing.length)} fail with every seed (${String(unreviewed.length)} not reviewed yet: tts-packs review)`,
  );
};

const failingItems = async (state: State): Promise<PackItem[]> => {
  const lists = await loadWordLists();
  const all = Object.values(lists).flatMap((rows) =>
    rows.flatMap(([word, , , readings]) => readings.map((reading) => ({ word, reading }))),
  );
  return unique(all).filter((item) => state.items[itemKey(item)]?.pass === false);
};

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PacksError("request body too large"));
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

const review = async (port: number): Promise<void> => {
  const state = await loadState();
  const failing = await failingItems(state);
  const byId = new Map(failing.map((item) => [fileId(item), item]));
  const keys = new Set(failing.map(itemKey));
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, body: string | Uint8Array, type: string): void => {
      response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(body);
    };
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && path === "/") {
      send(200, REVIEW_PAGE, "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && path === "/items") {
      const items = failing.map((item) => {
        const spoken = spokenPinyin({ words: [{ text: item.word, reading: item.reading }] });
        return {
          id: fileId(item),
          key: itemKey(item),
          word: item.word,
          spoken: spoken.ok ? spoken.value : item.reading,
          transcript: state.items[itemKey(item)]?.transcript ?? "",
        };
      });
      send(200, JSON.stringify(items), "application/json");
      return;
    }
    if (request.method === "GET" && path === "/reviews") {
      send(
        200,
        JSON.stringify(await readParsed(reviewsPath, reviewsSchema, {})),
        "application/json",
      );
      return;
    }
    if (request.method === "POST" && path === "/reviews") {
      const parsed = reviewsSchema.safeParse(JSON.parse(await readBody(request)) as unknown);
      const unknown = parsed.success
        ? Object.keys(parsed.data).filter((key) => !keys.has(key))
        : [];
      if (!parsed.success || unknown.length > 0) {
        send(
          400,
          parsed.success ? `unknown items: ${unknown.join(", ")}` : parsed.error.message,
          "text/plain; charset=utf-8",
        );
        return;
      }
      await writeAtomic(reviewsPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
      send(204, "", "text/plain");
      return;
    }
    const item = byId.get(/^\/audio\/([0-9a-f]{16})$/u.exec(path)?.[1] ?? "") ?? null;
    if (request.method === "GET" && item !== null) {
      send(200, await readFile(wavPath(item)), "audio/wav");
      return;
    }
    send(404, "not found", "text/plain");
  };
  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(String(error));
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `${String(failing.length)} recordings to review: http://127.0.0.1:${String(port)}/`,
    );
  });
  await new Promise((resolve) => server.on("close", resolve));
};

const ffmpegVersion = async (): Promise<string> => {
  try {
    const { stdout } = await run("ffmpeg", ["-version"]);
    return /^ffmpeg version \S+/u.exec(stdout)?.[0] ?? "ffmpeg";
  } catch (error) {
    throw new PacksError(
      `ffmpeg is needed to encode the packs (not found on PATH): ${String(error)}`,
    );
  }
};

/**
 * AI Act art. 50(2): synthetic audio is marked as AI-generated in a machine-readable format (ADR 0007), with
 * the IPTC digital source type for generative AI (cv.iptc.org/newscodes/digitalsourcetype, checked 2026-10-14).
 */
const AI_GENERATED = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const SYNTHETIC_NOTE = "Synthetic voice generated by MOSS-TTS v1.5 for OpenLinguo, CC0 1.0";

/** Mono MP3 at 48 kbps (ADR 0007); bit-exact flags keep the encoder's own version out of the file. */
const ENCODING = [
  ...["-ac", "1", "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-map_metadata", "-1"],
  ...["-id3v2_version", "3", "-write_id3v1", "0"],
  ...["-metadata", `digitalSourceType=${AI_GENERATED}`, "-metadata", `comment=${SYNTHETIC_NOTE}`],
  ...["-fflags", "+bitexact", "-flags:a", "+bitexact"],
];

const encodeMp3 = async (item: PackItem): Promise<Uint8Array> => {
  const wav = await readFile(wavPath(item));
  const mp3 = new URL(`${sha256(`${sha256(wav)} ${ENCODING.join(" ")}`).slice(0, 16)}.mp3`, mp3Dir);
  if (!(await exists(mp3))) {
    const input = ["-v", "error", "-y", "-i", fileURLToPath(wavPath(item))];
    try {
      await run("ffmpeg", [...input, ...ENCODING, fileURLToPath(mp3)]);
    } catch (error) {
      throw new PacksError(`ffmpeg failed on ${item.word}: ${String(error)}`);
    }
  }
  return new Uint8Array(await readFile(mp3));
};

/** The recording's pitch contour (core f0.ts); `null` when nothing in it is voiced. */
const contourOf = async (item: PackItem): Promise<(number | null)[] | null> => {
  const pcm = decodeWav(new Uint8Array(await readFile(wavPath(item))));
  if (!pcm.ok) throw new PacksError(`${item.word}: ${pcm.error}`);
  const result = contour(pcm.value.samples, pcm.value.sampleRate, syllableCount(item));
  if (result.ok) return [...result.value];
  if (result.error === "no-voice") return null;
  throw new PacksError(`${item.word} ${item.reading}: ${result.error}`);
};

const packBand = async (
  band: Band,
  entries: readonly PackItem[],
): Promise<{ file: string; bytes: number; sha256: string }[]> => {
  const parts: { item: PackItem; mp3: Uint8Array }[][] = [[]];
  let size = 0;
  for (const item of entries) {
    const mp3 = await encodeMp3(item);
    const current = parts.at(-1) ?? [];
    if (size + mp3.length > PART_BYTES && current.length > 0) {
      parts.push([]);
      size = 0;
    }
    (parts.at(-1) ?? current).push({ item, mp3 });
    size += mp3.length;
  }
  const written = [];
  for (const [index, part] of parts.entries()) {
    const files = [];
    for (const [at, { item, mp3 }] of part.entries()) {
      files.push({ name: `${String(at)}.mp3`, item, bytes: mp3, f0: await contourOf(item) });
    }
    const list = {
      digitalSourceType: AI_GENERATED,
      note: SYNTHETIC_NOTE,
      files: files.map(({ name, item, f0 }) => ({
        file: name,
        word: item.word,
        reading: item.reading,
        f0,
      })),
    };
    const zip = storedZip([
      { name: "index.json", bytes: new TextEncoder().encode(JSON.stringify(list)) },
      ...files,
    ]);
    if (!zip.ok) throw new PacksError(`${band.referential} ${String(band.level)}: ${zip.error}`);
    const file = `audio-zh-${band.referential}-${String(band.level)}-${String(index + 1)}.zip`;
    await writeAtomic(new URL(file, outDir), zip.value);
    written.push({ file, bytes: zip.value.length, sha256: sha256(zip.value) });
  }
  return written;
};

const GAPS_HEADER = "referential\tlevel\tsimplified\treading\treason";

const writeGaps = async (
  packed: readonly { band: Band; gaps: readonly Gap[] }[],
): Promise<void> => {
  const bandOf = (row: string): string => row.split("\t").slice(0, 2).join("\t");
  const replaced = new Set(packed.map(({ band }) => `${band.referential}\t${String(band.level)}`));
  const kept = (await exists(gapsPath))
    ? (await readFile(gapsPath, "utf8"))
        .split("\n")
        .slice(1)
        .filter((row) => row !== "" && !replaced.has(bandOf(row)))
    : [];
  const rows = packed.flatMap(({ band, gaps }) =>
    gaps.map(({ word, reading, reason }) =>
      [band.referential, String(band.level), word, reading, reason].join("\t"),
    ),
  );
  await writeAtomic(gapsPath, `${[GAPS_HEADER, ...[...kept, ...rows].sort()].join("\n")}\n`);
};

const pack = async (bands: readonly Band[]): Promise<void> => {
  const state = await loadState();
  const reviews = await readParsed(reviewsPath, reviewsSchema, {});
  const manifest = await readManifest(manifestPath);
  if (!manifest.ok)
    throw new PacksError(`cannot read data/manifest.json: ${JSON.stringify(manifest.error)}`);
  if (state.asr === null) throw new PacksError("nothing checked yet: run tts-packs build first");
  const pinned = (dataset: string): string => {
    const hash = manifest.value[dataset]?.sha256 ?? null;
    if (hash === null) throw new PacksError(`${dataset} is missing from data/manifest.json`);
    return hash;
  };
  const words = {
    [REFERENTIALS["hsk-2025"]]: pinned(REFERENTIALS["hsk-2025"]),
    [REFERENTIALS["gf0025-2021"]]: pinned(REFERENTIALS["gf0025-2021"]),
  };
  const generator = {
    tts: state.tts,
    voiceSha256: state.voiceSha256,
    asr: state.asr,
    encoder: `${await ffmpegVersion()}, libmp3lame ${MP3_BITRATE} mono, ID3 marked AI-generated`,
    f0: F0_VERSION,
  };
  const previous = await readParsed(packIndexPath, packIndexSchema.nullable(), null);
  if (
    previous !== null &&
    (JSON.stringify(previous.generator) !== JSON.stringify(generator) ||
      JSON.stringify(previous.words) !== JSON.stringify(words) ||
      previous.release !== RELEASE)
  ) {
    throw new PacksError(
      `${packIndexPath.pathname} holds bands built otherwise (generator, word lists or release): rebuild all of them together`,
    );
  }
  await mkdir(mp3Dir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const packed = [];
  for (const { band, items, gaps } of await loadBands(bands)) {
    const pending = items.filter((item) => (state.items[itemKey(item)]?.pass ?? null) === null);
    const unreviewed = items.filter(
      (item) => state.items[itemKey(item)]?.pass === false && !(itemKey(item) in reviews),
    );
    if (pending.length > 0 || unreviewed.length > 0) {
      throw new PacksError(
        `${band.referential} ${String(band.level)}: ${String(pending.length)} recordings not built or checked (tts-packs build), ${String(unreviewed.length)} waiting for review (tts-packs review)`,
      );
    }
    const kept = items.filter(
      (item) => state.items[itemKey(item)]?.pass === true || reviews[itemKey(item)] === "ok",
    );
    const rejected = items
      .filter((item) => reviews[itemKey(item)] === "bad")
      .map((item): Gap => ({ ...item, reason: "rejected" }));
    const parts = await packBand(band, kept);
    const validatedByEar = kept.filter((item) => state.items[itemKey(item)]?.pass === false).length;
    packed.push({
      band,
      gaps: [...gaps, ...rejected],
      entry: { ...band, entries: kept.length, validatedByEar, parts },
    });
    console.log(
      `${band.referential} ${String(band.level)}: ${String(kept.length)} recordings in ${String(parts.length)} part(s)`,
    );
  }
  const replaced = new Set(packed.map(({ band }) => `${band.referential}:${String(band.level)}`));
  const index: PackIndex = {
    release: RELEASE,
    license: "CC0-1.0",
    generator,
    words,
    bands: [
      ...(previous?.bands ?? []).filter(
        (entry) => !replaced.has(`${entry.referential}:${String(entry.level)}`),
      ),
      ...packed.map(({ entry }) => entry),
    ].sort((a, b) => a.referential.localeCompare(b.referential) || a.level - b.level),
  };
  await mkdir(new URL(".", packIndexPath), { recursive: true });
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;
  await writeAtomic(packIndexPath, indexJson);
  await writeGaps(packed);
  const next = {
    ...manifest.value,
    [AUDIO_DATASET]: {
      source: RELEASE_URL,
      license: "CC0-1.0",
      version: `${RELEASE}: ${generator.tts}, voice ${generator.voiceSha256.slice(0, 12)}, checked by ${generator.asr}, ${generator.encoder}, contours ${generator.f0}`,
      retrievedAt: new Date().toISOString(),
      maxAgeDays: 365,
      sha256: sha256(indexJson),
    },
  };
  await writeAtomic(manifestPath, serializeManifest(next));
  const files = index.bands.flatMap(({ parts }) =>
    parts.map(({ file }) => fileURLToPath(new URL(file, outDir))),
  );
  console.log(`Upload, after review: gh release upload ${RELEASE} --clobber ${files.join(" ")}`);
};

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    options: {
      band: { type: "string", multiple: true, default: [] },
      port: { type: "string", default: "8111" },
    },
    allowPositionals: true,
  });
  const bands = values.band.map(parseBand);
  const command = positionals[0] ?? "";
  if ((command === "build" || command === "pack") && bands.length === 0) {
    throw new PacksError("give at least one --band, e.g. --band hsk-2025:1");
  }
  switch (command) {
    case "build":
      await build(bands);
      return;
    case "review":
      await review(Number(values.port));
      return;
    case "pack":
      await pack(bands);
      return;
    default:
      throw new PacksError(
        "usage: packs.ts build --band hsk-2025:1 [--band …] | review [--port n] | pack --band hsk-2025:1 [--band …]",
      );
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof PacksError ? error.message : error);
  process.exitCode = 1;
});
