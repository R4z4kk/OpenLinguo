import type { Page } from "@playwright/test";

export type Store = "texts" | "knownMarks" | "aiSettings" | "reviews";

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

/** Every row of a store, as the app stored it. */
export const all = (page: Page, store: Store | "resolutions"): Promise<unknown[]> =>
  page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction(name, "readonly").objectStore(name).getAll();
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
