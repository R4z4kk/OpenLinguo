import { err, ok, type Result } from "@openlinguo/core";
import { z } from "zod";
import { decodeWav } from "./wav.ts";

export const ENGINE_IDS = ["moss-tts", "moss-tts-period", "voxcpm2"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** Ports of `tools/tts/compose.yaml`; moss-tts-period is the same server with a final 。 after words. */
const ENGINE_URLS: Readonly<Record<EngineId, string>> = {
  "moss-tts": "http://127.0.0.1:8106",
  "moss-tts-period": "http://127.0.0.1:8106",
  voxcpm2: "http://127.0.0.1:8109",
};

const engineInfoSchema = z.object({
  engine: z.string(),
  model: z.string(),
  revision: z.string(),
  speaker: z.string(),
});
export type EngineInfo = z.infer<typeof engineInfoSchema>;

const SYNTHESIS_TIMEOUT_MS = 5 * 60_000;

export const engineInfo = async (engine: EngineId): Promise<Result<EngineInfo, string>> => {
  const url = `${ENGINE_URLS[engine]}/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return err(`${engine}: HTTP ${String(response.status)} on ${url}`);
    const info = engineInfoSchema.safeParse(await response.json());
    return info.success ? ok(info.data) : err(`${engine}: unexpected /health body`);
  } catch (error) {
    return err(
      `${engine} is not reachable on ${url} (docker compose up ${engine}?): ${String(error)}`,
    );
  }
};

export const synthesize = async (
  engine: EngineId,
  text: string,
  seed: number,
): Promise<Result<Uint8Array, string>> => {
  try {
    const response = await fetch(`${ENGINE_URLS[engine]}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, seed }),
      signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
    });
    if (!response.ok) {
      return err(
        `${engine} failed on « ${text} »: HTTP ${String(response.status)} ${await response.text()}`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = decodeWav(bytes);
    return decoded.ok
      ? ok(bytes)
      : err(`${engine} returned invalid audio for « ${text} »: ${decoded.error}`);
  } catch (error) {
    return err(`${engine} failed on « ${text} »: ${String(error)}`);
  }
};
