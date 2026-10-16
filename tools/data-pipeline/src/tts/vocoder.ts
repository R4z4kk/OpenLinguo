import { err, ok, type Result } from "@openlinguo/core";
import { z } from "zod";
import { CONTOUR_POINTS, type Analysis } from "./tone-transfer.ts";
import { decodeWav } from "./wav.ts";

/** WORLD (tools/tts/world), port of `tools/tts/compose.yaml`. */
const VOCODER_URL = "http://127.0.0.1:8131";
const TIMEOUT_MS = 60_000;

const vocoderInfoSchema = z.object({ engine: z.literal("world"), version: z.string().min(1) });
export type VocoderInfo = z.infer<typeof vocoderInfoSchema>;

export const vocoderInfo = async (): Promise<Result<VocoderInfo, string>> => {
  const url = `${VOCODER_URL}/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return err(`world: HTTP ${String(response.status)} on ${url}`);
    const info = vocoderInfoSchema.safeParse(await response.json());
    return info.success ? ok(info.data) : err("world: unexpected /health body");
  } catch (error) {
    return err(`world is not reachable on ${url} (docker compose up world?): ${String(error)}`);
  }
};

const analysisSchema = z.union([
  z.strictObject({
    seconds: z.number().positive(),
    contour: z.array(z.number()).length(CONTOUR_POINTS),
  }),
  z.strictObject({ seconds: z.null(), contour: z.null() }),
]);

/** The voiced stretch of a recording; null when nothing in it is voiced. */
export const analyse = async (wav: Uint8Array): Promise<Result<Analysis | null, string>> => {
  try {
    const response = await fetch(`${VOCODER_URL}/analyse`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return err(`world: HTTP ${String(response.status)} ${await response.text()}`);
    }
    const body = analysisSchema.safeParse(await response.json());
    if (!body.success) return err("world: unexpected /analyse body");
    return ok(body.data.seconds === null ? null : body.data);
  } catch (error) {
    return err(`world: ${String(error)}`);
  }
};

/** The recording with its voiced stretch lasting `seconds` and following `contour` (tone-transfer.ts). */
export const transfer = async (
  wav: Uint8Array,
  contour: readonly number[],
  seconds: number,
): Promise<Result<Uint8Array, string>> => {
  try {
    const response = await fetch(`${VOCODER_URL}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav: Buffer.from(wav).toString("base64"), contour, seconds }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return err(`world: HTTP ${String(response.status)} ${await response.text()}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = decodeWav(bytes);
    return decoded.ok ? ok(bytes) : err(`world returned invalid audio: ${decoded.error}`);
  } catch (error) {
    return err(`world: ${String(error)}`);
  }
};
