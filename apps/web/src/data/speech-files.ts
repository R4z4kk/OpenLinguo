import type { SpeechModelFile, SpeechModelIndex } from "./format.ts";

// Shared by the page and the speech worker: the worker imports nothing else from data/.

export const MODELS = "/models/";
export const INDEX = "index.json";
export const CACHE_PREFIX = "speech-model-";

export const cacheName = ({ release }: SpeechModelIndex): string => `${CACHE_PREFIX}${release}`;
export const url = (path: string): string => `${MODELS}${path}`;

type Piece = { readonly path: string; readonly bytes: number; readonly sha256: string };

/** The pieces served for a file: its parts, or the file itself. */
export const pieces = (file: SpeechModelFile): readonly Piece[] => file.parts ?? [file];

/** A stored file as one response, its parts streamed in order; `null` when a piece is missing. */
export const storedFile = async (
  index: SpeechModelIndex,
  file: SpeechModelFile,
): Promise<Response | null> => {
  const responses: Response[] = [];
  for (const piece of pieces(file)) {
    // Not caches.open: it would create the cache again if the model was deleted while the worker loads it.
    const response = await caches.match(url(piece.path), { cacheName: cacheName(index) });
    if (response?.body == null) return null;
    responses.push(response);
  }
  const headers = {
    "Content-Length": String(file.bytes),
    "Content-Type": "application/octet-stream",
  };
  if (responses.length === 1) return new Response(responses[0]?.body ?? null, { headers });
  let current = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        reader ??= responses[current]?.body?.getReader() ?? null;
        if (reader === null) {
          controller.close();
          return;
        }
        const chunk = await reader.read();
        if (!chunk.done) {
          controller.enqueue(chunk.value);
          return;
        }
        reader = null;
        current += 1;
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason);
    },
  });
  return new Response(body, { headers });
};
