import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { contour, F0_VERSION, type Contour, type Result, type ToneClass } from "@openlinguo/core";
import { toDiacritic } from "@openlinguo/lang-zh";
import { z } from "zod";
import { dataDir, manifestPath, readManifest, serializeManifest } from "../manifest.ts";
import {
  heardToneMatches,
  loadCedictChars,
  transcriptMatches,
  type CharSyllables,
  type CharTones,
} from "./asr-check.ts";
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
  SYLLABLES,
  type Band,
  type Gap,
  type PackItem,
} from "./pack-words.ts";
import { loadSyllableSources, seedCandidates, syllableItems } from "./syllable-items.ts";
import { decodeWav, encodeWav, trimUtterance } from "./wav.ts";
import { toneDoubts, type SyllableRecording } from "./tone-doubt.ts";
import {
  CONTOUR_POINTS,
  pitchDistance,
  pitchLimits,
  rankSources,
  syllableOf,
  toneOf,
  toneTemplates,
  transferSeconds,
  transferSources,
  usableSource,
  type Analysis,
  type Source,
} from "./tone-transfer.ts";
import { analyse, transfer, vocoderInfo } from "./vocoder.ts";
import { storedZip } from "./zip.ts";

const run = promisify(execFile);

/**
 * Seeds tried before a recording that still fails: a wrong word goes to human review, a doubted tone ships
 * without audio (ADR 0007).
 */
const SEEDS = [1, 2, 3, 4, 5] as const;
const TONE_CLASS: Readonly<Record<string, ToneClass>> = { "1": 1, "2": 2, "3": 3, "4": 4 };
/** Pages serves files up to 25 MiB (developers.cloudflare.com/pages/platform/limits, checked 2026-10-14). */
const PART_BYTES = 20 * 1024 * 1024;
const MP3_BITRATE = "48k";
/** Bump for every rebuild: release assets are immutable once the app points to them. */
const RELEASE = "audio-zh-4";
/** Characters tried in turn for a chart syllable heard in no tone, each with every seed (seedCandidates). */
const SEED_CHARACTERS = 3;
/**
 * A tone transfer whose contour is further from its template than this share of the voice's own recordings of
 * that tone is not the pitch it was given (tone-transfer.ts pitchLimits).
 */
const PITCH_SHARE = 0.9;
const RELEASE_URL = `https://github.com/R4z4kk/OpenLinguo/releases/tag/${RELEASE}`;
const SERVICE_TIMEOUT_MS = 20 * 60_000;
const SAVE_EVERY = 50;
const MAX_BODY_BYTES = 10_000_000;

const workDir = new URL("../../../tts/.packs/", import.meta.url);
const wavDir = new URL("wav/", workDir);
const mp3Dir = new URL("mp3/", workDir);
const outDir = new URL("out/", workDir);
const transferDir = new URL("transfer/", workDir);
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
  /** An isolated syllable whose tone the transcript and the pitch both doubt (tone-doubt.ts). */
  toneDoubt: z.boolean().default(false),
});
const analysisSchema = z
  .strictObject({
    seconds: z.number().positive(),
    contour: z.array(z.number()).length(CONTOUR_POINTS),
  })
  .nullable();
const stateSchema = z.strictObject({
  tts: z.string(),
  voiceSha256: z.string(),
  asr: z.string().nullable(),
  items: z.record(z.string(), itemStateSchema),
  /** Characters recorded only as tone transfer sources (seedCandidates), never shipped as they are. */
  seeds: z.array(z.string()).default([]),
  /** The vocoder of the tone transfer; what follows is redone when it changes. */
  vocoder: z.string().nullable().default(null),
  /** WORLD's analysis of a recording by item key: null when nothing in it is voiced. */
  analyses: z.record(z.string(), analysisSchema).default({}),
  /** By file in transfer/: a source re-synthesized in its own tone, as its transfers are; is its syllable still heard? */
  roundTrips: z
    .record(
      z.string(),
      z.strictObject({
        source: z.string(),
        transcript: z.string().nullable(),
        pass: z.boolean().nullable(),
      }),
    )
    .default({}),
  /** For each missing chart pair (reading key): the source and file chosen, null when no transfer passes the checks. */
  transfers: z
    .record(z.string(), z.strictObject({ source: z.string(), file: z.string() }).nullable())
    .default({}),
});
type State = z.infer<typeof stateSchema>;
const reviewsSchema = z.record(z.string(), z.enum(["ok", "bad"]));

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const fileId = (item: PackItem): string => sha256(itemKey(item)).slice(0, 16);
const wavPath = (item: PackItem): URL => new URL(`${fileId(item)}.wav`, wavDir);
const keyItem = (key: string): PackItem => {
  const [word = "", reading = ""] = key.split("\t");
  return { word, reading };
};
/** A vocoded file is named after all it is made of: a changed template or vocoder gives a new file. */
const vocodedName = (
  source: string,
  contour: readonly number[],
  seconds: number,
  vocoder: string,
): string => `${sha256(JSON.stringify([source, contour, seconds, vocoder])).slice(0, 16)}.wav`;

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
  if (value === SYLLABLES) return { referential: SYLLABLES, level: 1 };
  const [referential = "", level = ""] = value.split(":");
  const number = Number(level);
  if (!isReferential(referential) || !Number.isInteger(number) || number < 1 || number > 7) {
    throw new PacksError(
      `invalid band ${value}: expected ${Object.keys(REFERENTIALS).join(" or ")}:1-7, or ${SYLLABLES}`,
    );
  }
  return { referential, level: number };
};

const loadBands = async (
  bands: readonly Band[],
  state: State,
  reviews: Readonly<Record<string, "ok" | "bad">>,
): Promise<
  { readonly band: Band; readonly items: readonly PackItem[]; readonly gaps: readonly Gap[] }[]
> => {
  const lists = await loadWordLists();
  const excluded = severalReadings(lists);
  const loaded = [];
  for (const band of bands) {
    if (band.referential !== SYLLABLES) {
      loaded.push({ band, ...bandItems(lists, band, excluded) });
      continue;
    }
    const sources = await loadSyllableSources();
    if (!sources.ok) throw new PacksError(`pinyin chart: ${sources.error.reading} is invalid`);
    const words = Object.values(lists).flatMap((rows) =>
      rows.flatMap(([word, , , readings]) => readings.map((reading) => ({ word, reading }))),
    );
    const shipped = words.filter(
      (item) =>
        !excluded.has(item.word) &&
        (state.items[itemKey(item)]?.pass === true || reviews[itemKey(item)] === "ok"),
    );
    loaded.push({ band, ...syllableItems({ ...sources.value, shipped }) });
  }
  return loaded;
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
    seeds: [],
    vocoder: null,
    analyses: {},
    roundTrips: {},
    transfers: {},
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
    state.items[itemKey(item)] = { seed, transcript: null, pass: null, toneDoubt: false };
    if ((index + 1) % SAVE_EVERY === 0 || index === todo.length - 1) {
      await saveState(state);
      console.log(`moss-tts seed ${String(seed)}: ${String(index + 1)} of ${String(todo.length)}`);
    }
  }
  await compose("stop", "moss-tts");
};

const startAsr = async (state: State): Promise<void> => {
  const info = await startService("qwen3-asr", asrInfo);
  const asr = `${info.model}@${info.revision}`;
  if (state.asr !== null && state.asr !== asr) {
    throw new PacksError(
      `${statePath.pathname} was checked with ${state.asr}, not ${asr}: move it away to start over`,
    );
  }
  state.asr = asr;
};

const check = async (
  items: readonly PackItem[],
  state: State,
  chars: CharSyllables,
): Promise<void> => {
  const todo = items.filter((item) => state.items[itemKey(item)]?.pass === null);
  if (todo.length === 0) return;
  await startAsr(state);
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

/**
 * Doubts the tone of isolated syllables (tone-doubt.ts) among the band's recordings that pass the word check;
 * every isolated syllable in the state trains the tone model of this voice. A reviewed recording keeps its verdict.
 */
const toneCheck = async (
  items: readonly PackItem[],
  state: State,
  tones: CharTones,
): Promise<void> => {
  const reviews = await readParsed(reviewsPath, reviewsSchema, {});
  const recordings: SyllableRecording[] = [];
  for (const [key, saved] of Object.entries(state.items)) {
    const [word = "", reading = ""] = key.split("\t");
    const tone = TONE_CLASS[/[1-5]$/u.exec(reading)?.[0] ?? ""] ?? null;
    const checked = saved.pass === true || saved.toneDoubt;
    if (reading.includes(" ") || tone === null || saved.transcript === null || !checked) continue;
    // A seed's tone is whatever MOSS-TTS said: it does not train the tone model.
    if (key in reviews || state.seeds.includes(key)) continue;
    const pcm = decodeWav(new Uint8Array(await readFile(wavPath({ word, reading }))));
    if (!pcm.ok) throw new PacksError(`${word}: ${pcm.error}`);
    const curve = contour(pcm.value.samples, pcm.value.sampleRate, 1);
    if (!curve.ok) continue;
    recordings.push({
      key,
      tone,
      contour: curve.value,
      heardTone: heardToneMatches(tones, reading, saved.transcript),
    });
  }
  const doubts = toneDoubts(recordings);
  if (!doubts.ok) throw new PacksError(`tone model: ${JSON.stringify(doubts.error)}`);
  const inBands = new Set(items.map(itemKey));
  for (const { key } of recordings) {
    const saved = state.items[key] ?? null;
    if (saved === null || !inBands.has(key)) continue;
    const doubt = doubts.value.has(key);
    state.items[key] = { ...saved, pass: !doubt, toneDoubt: doubt };
  }
  await saveState(state);
  const inBand = [...doubts.value].filter((key) => inBands.has(key)).length;
  console.log(`tone check: ${String(inBand)} isolated syllables doubted`);
};

type BandItems = { readonly items: readonly PackItem[]; readonly gaps: readonly Gap[] };

const ships = (key: string, state: State, reviews: Readonly<Record<string, "ok" | "bad">>) =>
  state.items[key]?.pass === true || reviews[key] === "ok";

/** The chart's pairs (reading keys) without a recording that ships: failing every check, rejected, or without a character. */
const missingPairs = (
  chart: BandItems,
  state: State,
  reviews: Readonly<Record<string, "ok" | "bad">>,
): string[] => [
  ...new Set([
    ...chart.items
      .filter((item) => !ships(itemKey(item), state, reviews))
      .map(({ reading }) => reading),
    ...chart.gaps.map(({ reading }) => reading),
  ]),
];

const sourcesOf = (
  state: State,
  reviews: Readonly<Record<string, "ok" | "bad">>,
  chars: CharSyllables,
): Map<string, Source[]> =>
  transferSources({
    recordings: Object.entries(state.items),
    seeds: new Set(state.seeds),
    reviews,
    heard: (reading, transcript) => transcriptMatches(chars, reading, transcript),
  });

/**
 * Records seeds for the missing pairs whose syllable is heard in no tone: up to SEED_CHARACTERS characters in turn,
 * each with every seed, checked like the other recordings but for the syllable only (seedCandidates).
 */
const recordSeeds = async (
  missing: readonly string[],
  state: State,
  reviews: Readonly<Record<string, "ok" | "bad">>,
  chars: CharSyllables,
): Promise<void> => {
  const sources = await loadSyllableSources();
  if (!sources.ok) throw new PacksError(`pinyin chart: ${sources.error.reading} is invalid`);
  const { readings, frequency } = sources.value;
  for (let rank = 0; rank < SEED_CHARACTERS; rank++) {
    const heard = sourcesOf(state, reviews, chars);
    const silent = [...new Set(missing.map(syllableOf))].filter((syllable) => !heard.has(syllable));
    const items = silent.flatMap((syllable) => {
      const recorded = new Set(
        Object.keys(state.items)
          .filter(
            (key) => !state.seeds.includes(key) && syllableOf(keyItem(key).reading) === syllable,
          )
          .map((key) => keyItem(key).word),
      );
      const candidates = seedCandidates({
        syllable,
        readings,
        frequency,
        excluded: recorded,
        limit: SEED_CHARACTERS,
      });
      return candidates.slice(rank, rank + 1);
    });
    if (items.length === 0) return;
    state.seeds = [...new Set([...state.seeds, ...items.map(itemKey)])];
    console.log(`seeds, character ${String(rank + 1)}: ${items.map(({ word }) => word).join(" ")}`);
    for (const seed of SEEDS) {
      await generate(items, state, seed);
      await check(items, state, chars);
    }
  }
};

/** The voice's recordings that ship in the chart band, with their tone: what the templates and limits come from. */
const chartRecordings = (
  chart: BandItems,
  state: State,
  reviews: Readonly<Record<string, "ok" | "bad">>,
) =>
  chart.items.flatMap((item) => {
    const tone = toneOf(item.reading);
    return tone !== null && ships(itemKey(item), state, reviews) ? [{ item, tone }] : [];
  });

const pcmContour = async (wav: URL): Promise<Contour | null> => {
  const pcm = decodeWav(new Uint8Array(await readFile(wav)));
  if (!pcm.ok) throw new PacksError(`${wav.pathname}: ${pcm.error}`);
  const result = contour(pcm.value.samples, pcm.value.sampleRate, 1);
  return result.ok ? result.value : null;
};

/**
 * Gives each missing chart pair a recording of its syllable in another tone with the pitch of its own (ADR 0007,
 * tone-transfer.ts). A transfer ships when its source, re-synthesized in its own tone, is still heard as its
 * syllable by the recognizer, and when the app's pitch code finds the contour it was given. No one listens.
 */
const transferMissing = async (
  chart: BandItems,
  state: State,
  chars: CharSyllables,
): Promise<void> => {
  const reviews = await readParsed(reviewsPath, reviewsSchema, {});
  const missing = missingPairs(chart, state, reviews);
  if (missing.length === 0) return;
  await recordSeeds(missing, state, reviews, chars);
  const bySyllable = sourcesOf(state, reviews, chars);
  const candidates = new Map(
    missing.map((pair) => [pair, rankSources(bySyllable.get(syllableOf(pair)) ?? [])]),
  );
  const recordings = chartRecordings(chart, state, reviews);

  const info = await startService("world", vocoderInfo);
  const vocoder = info.version;
  if (state.vocoder !== vocoder) {
    state.vocoder = vocoder;
    state.analyses = {};
    state.transfers = {};
  }
  await mkdir(transferDir, { recursive: true });
  const analysed = async (key: string): Promise<Analysis | null> => {
    if (key in state.analyses) return state.analyses[key] ?? null;
    const result = await analyse(new Uint8Array(await readFile(wavPath(keyItem(key)))));
    if (!result.ok) throw new PacksError(`${key}: ${result.error}`);
    state.analyses[key] =
      result.value === null ? null : { ...result.value, contour: [...result.value.contour] };
    return result.value;
  };
  const measured = [];
  for (const { item, tone } of recordings) {
    const analysis = await analysed(itemKey(item));
    if (analysis !== null) measured.push({ tone, analysis });
  }
  const templates = toneTemplates(measured);
  if (!templates.ok)
    throw new PacksError(`tone templates: no recording in tone ${String(templates.error.tone)}`);
  /** The source with its voiced stretch lasting `seconds` and the pitch of the `target` tone. */
  const vocode = async (key: string, target: ToneClass, seconds: number): Promise<string> => {
    const { contour: pitch } = templates.value[target];
    const name = vocodedName(key, pitch, seconds, vocoder);
    if (await exists(new URL(name, transferDir))) return name;
    const wav = new Uint8Array(await readFile(wavPath(keyItem(key))));
    const result = await transfer(wav, pitch, seconds);
    if (!result.ok) throw new PacksError(`${key} to tone ${String(target)}: ${result.error}`);
    await writeAtomic(new URL(name, transferDir), result.value);
    return name;
  };
  // Every source once in its own tone and length (the round trip), then into each missing tone of its syllable.
  const roundTrips = new Map<string, string>();
  const transfers = new Map<string, string>();
  for (const [pair, ranked] of candidates) {
    const target = toneOf(pair);
    for (const { key, reading } of ranked) {
      const analysis = await analysed(key);
      const tone = toneOf(reading);
      if (analysis === null || tone === null || target === null) continue;
      if (!usableSource(analysis, tone, templates.value)) continue;
      if (!roundTrips.has(key)) {
        const name = await vocode(key, tone, analysis.seconds);
        roundTrips.set(key, name);
        state.roundTrips[name] ??= { source: key, transcript: null, pass: null };
      }
      const seconds = transferSeconds(templates.value, tone, analysis.seconds, target);
      transfers.set(`${pair}\t${key}`, await vocode(key, target, seconds));
    }
  }
  await saveState(state);
  await compose("stop", "world");

  const unheard = [...roundTrips.values()].filter((name) => state.roundTrips[name]?.pass === null);
  if (unheard.length > 0) {
    await startAsr(state);
    for (const name of unheard) {
      const text = await transcribe(new Uint8Array(await readFile(new URL(name, transferDir))));
      const trip = state.roundTrips[name] ?? null;
      if (!text.ok || trip === null)
        throw new PacksError(`round trip ${name}: ${text.ok ? "unknown" : text.error}`);
      state.roundTrips[name] = {
        ...trip,
        transcript: text.value,
        pass: transcriptMatches(chars, keyItem(trip.source).reading, text.value),
      };
    }
    await saveState(state);
    await compose("stop", "qwen3-asr");
  }

  const contours = [];
  for (const { item, tone } of recordings) {
    const curve = await pcmContour(wavPath(item));
    if (curve !== null) contours.push({ tone, contour: curve });
  }
  const limits = pitchLimits(contours, templates.value, PITCH_SHARE);
  for (const [pair, ranked] of candidates) {
    const target = toneOf(pair);
    state.transfers[pair] = null;
    for (const { key } of ranked) {
      const trip = state.roundTrips[roundTrips.get(key) ?? ""] ?? null;
      const file = transfers.get(`${pair}\t${key}`) ?? null;
      if (target === null || trip?.pass !== true || file === null) continue;
      const curve = await pcmContour(new URL(file, transferDir));
      const distance = curve === null ? null : pitchDistance(curve, templates.value[target]);
      if (distance !== null && distance <= limits[target]) {
        state.transfers[pair] = { source: key, file };
        break;
      }
    }
  }
  await saveState(state);
  const transferred = missing.filter((pair) => (state.transfers[pair] ?? null) !== null).length;
  const sourceless = missing.filter((pair) => (candidates.get(pair) ?? []).length === 0).length;
  console.log(
    `tone transfer: ${String(missing.length)} chart pairs missing, ${String(transferred)} transferred, ${String(sourceless)} with no recording of their syllable in any tone`,
  );
};

const build = async (bands: readonly Band[]): Promise<void> => {
  const state = await loadState();
  const loaded = await loadBands(bands, state, await readParsed(reviewsPath, reviewsSchema, {}));
  const items = unique(loaded.flatMap(({ items: bandOnes }) => bandOnes));
  const { syllables, tones } = await loadCedictChars();
  await mkdir(workDir, { recursive: true });
  // The checks are code and the transcripts are kept: a changed check applies to them without the GPU.
  for (const item of items) {
    const saved = state.items[itemKey(item)] ?? null;
    if (saved?.transcript == null) continue;
    state.items[itemKey(item)] = {
      ...saved,
      pass: transcriptMatches(syllables, item.reading, saved.transcript),
      toneDoubt: false,
    };
  }
  await saveState(state);
  for (const seed of SEEDS) {
    await generate(items, state, seed);
    await check(items, state, syllables);
    await toneCheck(items, state, tones);
  }
  const chart = loaded.find(({ band }) => band.referential === SYLLABLES) ?? null;
  if (chart !== null) await transferMissing(chart, state, syllables);
  const reviews = await readParsed(reviewsPath, reviewsSchema, {});
  const failing = items.filter((item) => state.items[itemKey(item)]?.pass === false);
  const doubted = failing.filter((item) => state.items[itemKey(item)]?.toneDoubt === true);
  const unreviewed = failing.filter((item) => !(itemKey(item) in reviews));
  console.log(
    `${String(items.length)} recordings, ${String(items.length - failing.length)} pass the checks, ${String(failing.length)} fail with every seed (${String(doubted.length)} for their tone); ${String(unreviewed.length)} without a verdict by ear ship without audio (tts-packs review to validate words)`,
  );
};

const failingItems = async (state: State): Promise<PackItem[]> => {
  const lists = await loadWordLists();
  const all = Object.values(lists).flatMap((rows) =>
    rows.flatMap(([word, , , readings]) => readings.map((reading) => ({ word, reading }))),
  );
  // A doubted tone ships without audio: only wrong words are reviewed by ear.
  return unique(all).filter((item) => {
    const saved = state.items[itemKey(item)] ?? null;
    return saved?.pass === false && !saved.toneDoubt;
  });
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
const TRANSFER_NOTE =
  "Synthetic voice generated by MOSS-TTS v1.5 for OpenLinguo, its tone changed by the WORLD vocoder, CC0 1.0";

/** Mono MP3 at 48 kbps (ADR 0007); bit-exact flags keep the encoder's own version out of the file. */
const encoding = (note: string): string[] => [
  ...["-ac", "1", "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-map_metadata", "-1"],
  ...["-id3v2_version", "3", "-write_id3v1", "0"],
  ...["-metadata", `digitalSourceType=${AI_GENERATED}`, "-metadata", `comment=${note}`],
  ...["-fflags", "+bitexact", "-flags:a", "+bitexact"],
];

/** A recording in a pack: its WAV, and for a tone transfer the recording it was made from. */
type PackEntry = { readonly item: PackItem; readonly wav: URL; readonly source: PackItem | null };

const encodeMp3 = async ({ item, wav, source }: PackEntry): Promise<Uint8Array> => {
  const args = encoding(source === null ? SYNTHETIC_NOTE : TRANSFER_NOTE);
  const pcm = await readFile(wav);
  const mp3 = new URL(`${sha256(`${sha256(pcm)} ${args.join(" ")}`).slice(0, 16)}.mp3`, mp3Dir);
  if (!(await exists(mp3))) {
    const input = ["-v", "error", "-y", "-i", fileURLToPath(wav)];
    try {
      await run("ffmpeg", [...input, ...args, fileURLToPath(mp3)]);
    } catch (error) {
      throw new PacksError(`ffmpeg failed on ${item.word}: ${String(error)}`);
    }
  }
  return new Uint8Array(await readFile(mp3));
};

/** The recording's pitch contour (core f0.ts); `null` when nothing in it is voiced. */
const contourOf = async ({ item, wav }: PackEntry): Promise<(number | null)[] | null> => {
  const pcm = decodeWav(new Uint8Array(await readFile(wav)));
  if (!pcm.ok) throw new PacksError(`${item.word}: ${pcm.error}`);
  const result = contour(pcm.value.samples, pcm.value.sampleRate, syllableCount(item));
  if (result.ok) return [...result.value];
  if (result.error === "no-voice") return null;
  throw new PacksError(`${item.word} ${item.reading}: ${result.error}`);
};

const packBand = async (
  band: Band,
  entries: readonly PackEntry[],
): Promise<{ file: string; bytes: number; sha256: string }[]> => {
  const parts: { entry: PackEntry; mp3: Uint8Array }[][] = [[]];
  let size = 0;
  for (const entry of entries) {
    const mp3 = await encodeMp3(entry);
    const current = parts.at(-1) ?? [];
    if (size + mp3.length > PART_BYTES && current.length > 0) {
      parts.push([]);
      size = 0;
    }
    (parts.at(-1) ?? current).push({ entry, mp3 });
    size += mp3.length;
  }
  const written = [];
  for (const [index, part] of parts.entries()) {
    const files = [];
    for (const [at, { entry, mp3 }] of part.entries()) {
      files.push({ name: `${String(at)}.mp3`, entry, bytes: mp3, f0: await contourOf(entry) });
    }
    const list = {
      digitalSourceType: AI_GENERATED,
      note: SYNTHETIC_NOTE,
      files: files.map(({ name, entry: { item, source }, f0 }) => ({
        file: name,
        word: item.word,
        reading: item.reading,
        f0,
        // A tone transfer: this recording of the same syllable with the pitch of another tone (TRANSFER_NOTE).
        ...(source === null ? {} : { source }),
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

/**
 * The chart's tone transfers chosen by `tts-packs build`, and the pairs still without audio: `no-source` when no
 * recording of the syllable is heard in any tone, `unverified` when no transfer passes the checks.
 */
const chartTransfers = (
  chart: BandItems,
  state: State,
  reviews: Readonly<Record<string, "ok" | "bad">>,
  chars: CharSyllables,
): { readonly entries: readonly PackEntry[]; readonly gaps: readonly Gap[] } => {
  const missing = missingPairs(chart, state, reviews);
  const undecided = missing.filter((pair) => !(pair in state.transfers));
  if (undecided.length > 0) {
    throw new PacksError(
      `syllables: ${String(undecided.length)} pairs without a tone transfer decision (tts-packs build --band ${SYLLABLES})`,
    );
  }
  const heard = sourcesOf(state, reviews, chars);
  const entries: PackEntry[] = [];
  const gaps: Gap[] = [];
  for (const reading of missing) {
    const chosen = state.transfers[reading] ?? null;
    const word = toDiacritic(reading);
    if (!word.ok) throw new PacksError(`syllables: ${reading} is invalid`);
    if (chosen === null) {
      const char = chart.items.find((item) => item.reading === reading)?.word ?? "";
      const reason = heard.has(syllableOf(reading)) ? "unverified" : "no-source";
      gaps.push({ word: char, reading, reason });
      continue;
    }
    entries.push({
      item: { word: word.value, reading },
      wav: new URL(chosen.file, transferDir),
      source: keyItem(chosen.source),
    });
  }
  return { entries, gaps };
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
    vocoder: state.vocoder,
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
  for (const { band, items, gaps } of await loadBands(bands, state, reviews)) {
    const pending = items.filter((item) => (state.items[itemKey(item)]?.pass ?? null) === null);
    if (pending.length > 0) {
      throw new PacksError(
        `${band.referential} ${String(band.level)}: ${String(pending.length)} recordings not built or checked (tts-packs build)`,
      );
    }
    const kept = items.filter((item) => ships(itemKey(item), state, reviews));
    const rejected = items
      .filter((item) => reviews[itemKey(item)] === "bad")
      .map((item): Gap => ({ ...item, reason: "rejected" }));
    // Failing every seed with no verdict by ear: no audio rather than an unchecked one.
    const unverified = items
      .filter((item) => state.items[itemKey(item)]?.pass === false && !(itemKey(item) in reviews))
      .map((item): Gap => ({ ...item, reason: "unverified" }));
    const chart =
      band.referential === SYLLABLES
        ? chartTransfers({ items, gaps }, state, reviews, (await loadCedictChars()).syllables)
        : null;
    const entries = [
      ...kept.map((item): PackEntry => ({ item, wav: wavPath(item), source: null })),
      ...(chart?.entries ?? []),
    ];
    const parts = await packBand(band, entries);
    const validatedByEar = kept.filter((item) => state.items[itemKey(item)]?.pass === false).length;
    packed.push({
      band,
      gaps: chart?.gaps ?? [...gaps, ...rejected, ...unverified],
      entry: { ...band, entries: entries.length, validatedByEar, parts },
    });
    console.log(
      `${band.referential} ${String(band.level)}: ${String(entries.length)} recordings in ${String(parts.length)} part(s)${chart === null ? "" : `, ${String(chart.entries.length)} by tone transfer`}`,
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
      version: `${RELEASE}: ${generator.tts}, voice ${generator.voiceSha256.slice(0, 12)}, checked by ${generator.asr}, ${generator.encoder}, contours ${generator.f0}${generator.vocoder === null ? "" : `, tone transfer by ${generator.vocoder}`}`,
      retrievedAt: new Date().toISOString(),
      maxAgeDays: 365,
      sha256: sha256(indexJson),
    },
  };
  await writeAtomic(manifestPath, serializeManifest(next));
  const files = packed.flatMap(({ entry }) =>
    entry.parts.map(({ file }) => fileURLToPath(new URL(file, outDir))),
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
        `usage: packs.ts build --band hsk-2025:1 [--band …] | review [--port n] | pack --band hsk-2025:1 [--band …]; --band ${SYLLABLES} for the pinyin chart`,
      );
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof PacksError ? error.message : error);
  process.exitCode = 1;
});
