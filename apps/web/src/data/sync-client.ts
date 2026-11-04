import { err, ok, parseWith, type Result } from "@openlinguo/core";
import { StoredChunk, SYNC_HEADERS } from "@openlinguo/core/sync";
import { type ApiFailure, refusedWith, request } from "./api.ts";

/** The next chunk after a cursor, or the end of the store, the only answer to carry the usage. */
export type NextChunk =
  | {
      readonly id: number;
      readonly bytes: Uint8Array;
      readonly oldest: number | null;
      readonly used: null;
    }
  | {
      readonly id: null;
      readonly bytes: null;
      readonly oldest: number | null;
      readonly used: number;
    };

const PATH = "/api/sync/chunks";
const unexpected = (response: Response): ApiFailure => ({
  kind: "unexpected",
  status: response.status,
});

const count = (response: Response, name: string): number | null => {
  const text = response.headers.get(name);
  return text !== null && /^\d+$/u.test(text) ? Number(text) : null;
};

/** Answers the failure of a refused response, reading the body it carries. */
const refused = async (response: Response): Promise<ApiFailure> =>
  refusedWith(response, await response.json().catch(() => null));

/** `expectedOldest`: the oldest chunk the device remembers; the server refuses if it changed. */
export const pushChunk = async (
  bytes: Uint8Array,
  expectedOldest: number | null,
): Promise<Result<StoredChunk, ApiFailure>> => {
  const answer = await request(PATH, {
    method: "POST",
    body: new Uint8Array(bytes),
    headers: {
      "content-type": "application/gzip",
      ...(expectedOldest === null ? {} : { [SYNC_HEADERS.expectedOldest]: String(expectedOldest) }),
    },
  });
  if (!answer.ok) return answer;
  const response = answer.value;
  if (!response.ok) return err(await refused(response));
  const stored = parseWith(StoredChunk, await response.json().catch(() => null));
  return stored.ok ? ok(stored.value) : err(unexpected(response));
};

export const nextChunk = async (after: number): Promise<Result<NextChunk, ApiFailure>> => {
  const answer = await request(`${PATH}/next?after=${String(after)}`, { method: "GET" });
  if (!answer.ok) return answer;
  const response = answer.value;
  if (!response.ok) return err(await refused(response));
  const oldest = count(response, SYNC_HEADERS.oldest);
  if (oldest === 0) return err(unexpected(response));
  if (response.status === 204) {
    const used = count(response, SYNC_HEADERS.used);
    return used === null ? err(unexpected(response)) : ok({ id: null, bytes: null, oldest, used });
  }
  const id = count(response, SYNC_HEADERS.id);
  if (id === null || id === 0 || response.status !== 200) return err(unexpected(response));
  try {
    return ok({ id, bytes: new Uint8Array(await response.arrayBuffer()), oldest, used: null });
  } catch {
    return err({ kind: "offline" });
  }
};

/** Whether the account's store holds a chunk, whatever this device remembers. Decodes nothing. */
export const holdsChunks = async (): Promise<Result<boolean, ApiFailure>> => {
  const next = await nextChunk(0);
  return next.ok ? ok(next.value.id !== null) : next;
};

export const deleteStore = async (): Promise<Result<null, ApiFailure>> => {
  const answer = await request(PATH, { method: "DELETE" });
  if (!answer.ok) return answer;
  const response = answer.value;
  if (response.status === 204) return ok(null);
  return err(response.ok ? unexpected(response) : await refused(response));
};
