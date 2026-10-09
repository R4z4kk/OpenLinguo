import { err, ok, type Result } from "@openlinguo/core";

export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];

const STORAGE_KEY = "openlinguo.theme";

export const parsePreference = (value: string | null): ThemePreference =>
  themePreferences.find((preference) => preference === value) ?? "system";

/** The stored preference, `system` when none is stored; fails when storage is unavailable. */
export const loadPreference = (
  storage: () => Pick<Storage, "getItem">,
): Result<ThemePreference, string> => {
  try {
    return ok(parsePreference(storage().getItem(STORAGE_KEY)));
  } catch (error) {
    return err(String(error));
  }
};

export const savePreference = (
  storage: () => Pick<Storage, "setItem">,
  preference: ThemePreference,
): Result<null, string> => {
  try {
    storage().setItem(STORAGE_KEY, preference);
    return ok(null);
  } catch (error) {
    return err(String(error));
  }
};

/** `system` follows the operating system through `color-scheme: light dark`. */
export const applyPreference = (
  root: Pick<Element, "setAttribute" | "removeAttribute">,
  preference: ThemePreference,
): void => {
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
};
