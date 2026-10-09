import { describe, expect, it } from "vitest";
import { applyPreference, loadPreference, parsePreference, savePreference } from "./theme.ts";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const failing = (): never => {
  throw new Error("SecurityError");
};

describe("theme preference", () => {
  it("defaults to system for a missing or unknown value", () => {
    expect(parsePreference(null)).toBe("system");
    expect(parsePreference("sepia")).toBe("system");
    expect(parsePreference("dark")).toBe("dark");
  });

  it("round-trips through storage", () => {
    const storage = memory();
    expect(savePreference(() => storage, "dark")).toEqual({ ok: true, value: null });
    expect(loadPreference(() => storage)).toEqual({ ok: true, value: "dark" });
  });

  it("reports an unavailable storage instead of hiding it", () => {
    expect(loadPreference(failing)).toEqual({ ok: false, error: "Error: SecurityError" });
    expect(savePreference(failing, "light").ok).toBe(false);
  });

  it("sets data-theme for an explicit choice and removes it for system", () => {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
      removeAttribute: (name: string) => {
        attributes.delete(name);
      },
    };
    applyPreference(root, "dark");
    expect(attributes.get("data-theme")).toBe("dark");
    applyPreference(root, "system");
    expect(attributes.has("data-theme")).toBe(false);
  });
});
