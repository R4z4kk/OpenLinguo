import type { Page } from "@playwright/test";
import { recorded } from "./ai-replay.ts";

/** Real answers of Ollama 0.35.1 with qwen3:30b-a3b: these sentences corrected. */
export const CORRECTED = recorded(new URL("fixtures/ai/local-correction.json", import.meta.url));
export const LOCAL_SERVER = "http://localhost:11434/v1";
export const MODEL = "qwen3:30b-a3b";
export const SENTENCES = [
  "我给妈妈打电话。",
  "你的电话号码是多少？",
  "我电话很新。",
  "晚上我不想接电话。",
  "请你电话我。",
];

export const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/gu, (_, name: string) => String(values[name]));

/** The local server set up, and today's challenge saved, as the app stores them. */
export const seedChallenge = (
  page: Page,
  corrections: readonly unknown[] = SENTENCES.map(() => null),
): Promise<void> =>
  page.evaluate(
    ({ sentences, model, corrections }) =>
      new Promise<void>((resolve, reject) => {
        const now = new Date();
        const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
          .map((part) => String(part).padStart(2, "0"))
          .join("-");
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(["aiSettings", "challenges"], "readwrite");
          transaction.objectStore("aiSettings").put({
            id: "ai",
            provider: "local",
            localAddress: "http://localhost:11434",
            rememberKey: true,
            key: null,
            model: { provider: "local", id: model, mode: "json_schema" },
          });
          transaction.objectStore("challenges").put({
            day,
            headword: "电话",
            readingKey: "dian4 hua4",
            sentences,
            corrections,
            updatedAt: 1,
          });
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { sentences: SENTENCES, model: MODEL, corrections },
  );

/** Every row of an IndexedDB store of the app. */
export const storedRows = (page: Page, store: string): Promise<unknown> =>
  page.evaluate(
    (name) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction(name).objectStore(name).getAll();
          request.onerror = () => {
            reject(new Error(String(request.error)));
          };
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
    store,
  );
