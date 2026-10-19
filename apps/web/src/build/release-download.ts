import { setTimeout } from "node:timers/promises";

export const ATTEMPTS = 3;
export const BACKOFF_MS = 1000;

export type ReleaseIo = {
  readonly fetch: (url: string) => Promise<Response>;
  readonly wait: (ms: number) => Promise<void>;
  readonly warn: (message: string) => void;
};

const NODE_IO: ReleaseIo = {
  fetch: (url) => fetch(url),
  wait: async (ms) => {
    await setTimeout(ms);
  },
  warn: (message) => {
    console.warn(message);
  },
};

class HttpError extends Error {
  readonly transient: boolean;

  constructor(status: number) {
    super(`HTTP ${String(status)}`);
    this.transient = status === 403 || status === 429 || status >= 500;
  }
}

const attempt = async (url: string, io: ReleaseIo): Promise<Uint8Array> => {
  const response = await io.fetch(url);
  if (!response.ok) throw new HttpError(response.status);
  return new Uint8Array(await response.arrayBuffer());
};

/** Downloads a release asset, retrying 403, 429, 5xx and network errors; the last failure throws. */
export const downloadRelease = async (
  url: string,
  io: ReleaseIo = NODE_IO,
): Promise<Uint8Array> => {
  for (let tries = 1; ; tries += 1) {
    try {
      return await attempt(url, io);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const retried = !(error instanceof HttpError) || error.transient;
      if (!retried || tries >= ATTEMPTS) {
        throw new Error(`${url}: ${reason} (${String(tries)} attempt(s))`, { cause: error });
      }
      const delay = BACKOFF_MS * 2 ** (tries - 1);
      io.warn(`${url}: ${reason}, retrying in ${String(delay)} ms`);
      await io.wait(delay);
    }
  }
};
