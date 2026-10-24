import type { Page } from "@playwright/test";

type SeedCard = { readonly headword: string; readonly readingKey: string };

/** Stores a reading's cards of these types as started, so another type comes next. */
export const startCards = (
  page: Page,
  { headword, readingKey }: SeedCard,
  types: readonly string[],
  phase: "review" | "learning" = "review",
): Promise<void> =>
  page.evaluate(
    ({ headword, readingKey, types, phase }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction("cards", "readwrite");
          for (const type of types) {
            transaction.objectStore("cards").put({
              id: JSON.stringify(["zh", headword, readingKey, type]),
              language: "zh",
              headword,
              readingKey,
              type,
              phase,
              due: Date.now() + 5 * 24 * 60 * 60 * 1000,
              stability: 5,
              difficulty: 5,
              reps: 1,
              lapses: 0,
              learningSteps: 0,
              scheduledDays: 5,
              firstReviewDay: "2026-10-10",
              lastReviewDay: "2026-10-10",
            });
          }
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { headword, readingKey, types, phase },
  );

/** Stores a reading's recognition and recall cards as started, so its tone or writing card comes next. */
export const startReading = (page: Page, card: SeedCard): Promise<void> =>
  startCards(page, card, ["recognition", "recall"]);
