export type Persistence = "granted" | "denied" | "unsupported";

type StorageApi = Pick<StorageManager, "persist" | "persisted">;

/** `navigator.storage`, absent in some browsers and insecure contexts. */
export const browserStorage = (): StorageApi | null =>
  "storage" in navigator ? navigator.storage : null;

/** Asks the browser to keep the offline data under storage pressure. */
export const requestPersistence = async (storage: StorageApi | null): Promise<Persistence> => {
  if (storage === null) return "unsupported";
  try {
    return (await storage.persisted()) || (await storage.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
};
