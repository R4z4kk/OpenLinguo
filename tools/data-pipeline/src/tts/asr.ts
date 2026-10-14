import { err, ok, type Result } from "@openlinguo/core";
import { z } from "zod";

/** Qwen3-ASR, chosen over Whisper large-v3 and FireRedASR2-AED (ADR 0007); port of `tools/tts/compose.yaml`. */
const ASR_URL = "http://127.0.0.1:8121";

const asrInfoSchema = z.object({ engine: z.string(), model: z.string(), revision: z.string() });
export type AsrInfo = z.infer<typeof asrInfoSchema>;

export const asrInfo = async (): Promise<Result<AsrInfo, string>> => {
  const url = `${ASR_URL}/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return err(`qwen3-asr: HTTP ${String(response.status)} on ${url}`);
    const info = asrInfoSchema.safeParse(await response.json());
    return info.success ? ok(info.data) : err("qwen3-asr: unexpected /health body");
  } catch (error) {
    return err(
      `qwen3-asr is not reachable on ${url} (docker compose up qwen3-asr?): ${String(error)}`,
    );
  }
};

const transcriptSchema = z.object({ text: z.string() });

export const transcribe = async (wav: Uint8Array): Promise<Result<string, string>> => {
  try {
    const response = await fetch(`${ASR_URL}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      return err(`qwen3-asr: HTTP ${String(response.status)} ${await response.text()}`);
    }
    const body = transcriptSchema.safeParse(await response.json());
    return body.success ? ok(body.data.text) : err("qwen3-asr: unexpected /transcribe body");
  } catch (error) {
    return err(`qwen3-asr: ${String(error)}`);
  }
};
