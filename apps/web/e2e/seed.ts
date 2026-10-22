import type { Page } from "@playwright/test";

export type Store = "texts" | "knownMarks";

/** Writes a row as the app stores it: the page must have opened the database once. */
export const put = (page: Page, store: Store, row: object): Promise<void> =>
  page.evaluate(
    ({ name, value }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(name, "readwrite");
          transaction.objectStore(name).put(value);
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { name: store, value: row },
  );
