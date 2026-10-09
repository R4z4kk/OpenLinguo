import { err, ok, type Result } from "@openlinguo/core";

/** A stored string, `null` when absent; fails when the browser refuses storage access. */
export const readStored = (
  storage: () => Pick<Storage, "getItem">,
  key: string,
): Result<string | null, string> => {
  try {
    return ok(storage().getItem(key));
  } catch (error) {
    return err(String(error));
  }
};

export const writeStored = (
  storage: () => Pick<Storage, "setItem">,
  key: string,
  value: string,
): Result<null, string> => {
  try {
    storage().setItem(key, value);
    return ok(null);
  } catch (error) {
    return err(String(error));
  }
};
