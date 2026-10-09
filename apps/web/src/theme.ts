import { ok, type Result } from "@openlinguo/core";
import { readStored, writeStored } from "@/lib/stored";

export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];

const STORAGE_KEY = "openlinguo.theme";

export const parsePreference = (value: string | null): ThemePreference =>
  themePreferences.find((preference) => preference === value) ?? "system";

/** The stored preference, `system` when none is stored; fails when storage is unavailable. */
export const loadPreference = (
  storage: () => Pick<Storage, "getItem">,
): Result<ThemePreference, string> => {
  const stored = readStored(storage, STORAGE_KEY);
  return stored.ok ? ok(parsePreference(stored.value)) : stored;
};

export const savePreference = (
  storage: () => Pick<Storage, "setItem">,
  preference: ThemePreference,
): Result<null, string> => writeStored(storage, STORAGE_KEY, preference);

/** `system` follows the operating system through `color-scheme: light dark`. */
export const applyPreference = (
  root: Pick<Element, "setAttribute" | "removeAttribute">,
  preference: ThemePreference,
): void => {
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
};
