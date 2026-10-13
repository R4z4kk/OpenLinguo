import { err, ok, type Result } from "@openlinguo/core";
import { z } from "zod";

export const ASR_IDS = ["whisper", "qwen3-asr", "firered-asr"] as const;
export type AsrId = (typeof ASR_IDS)[number];

/** Ports of `tools/tts/compose.yaml`. */
const ASR_URLS: Readonly<Record<AsrId, string>> = {
  whisper: "http://127.0.0.1:8120",
  "qwen3-asr": "http://127.0.0.1:8121",
  "firered-asr": "http://127.0.0.1:8122",
};

export const asrInfoSchema = z.object({
  engine: z.string(),
  model: z.string(),
  revision: z.string(),
});
export type AsrInfo = z.infer<typeof asrInfoSchema>;

export const asrInfo = async (asr: AsrId): Promise<Result<AsrInfo, string>> => {
  const url = `${ASR_URLS[asr]}/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return err(`${asr}: HTTP ${String(response.status)} on ${url}`);
    const info = asrInfoSchema.safeParse(await response.json());
    return info.success ? ok(info.data) : err(`${asr}: unexpected /health body`);
  } catch (error) {
    return err(`${asr} is not reachable on ${url} (docker compose up ${asr}?): ${String(error)}`);
  }
};

const transcriptSchema = z.object({ text: z.string() });

export const transcribe = async (asr: AsrId, wav: Uint8Array): Promise<Result<string, string>> => {
  try {
    const response = await fetch(`${ASR_URLS[asr]}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      return err(`${asr}: HTTP ${String(response.status)} ${await response.text()}`);
    }
    const body = transcriptSchema.safeParse(await response.json());
    return body.success ? ok(body.data.text) : err(`${asr}: unexpected /transcribe body`);
  } catch (error) {
    return err(`${asr}: ${String(error)}`);
  }
};
