import { describe, expect, it } from "vitest";
import { browserLanguage, loadLanguage, saveLanguage } from "./language.ts";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const unavailable = (): never => {
  throw new Error("SecurityError");
};

describe("language", () => {
  it("takes the first supported browser language, English otherwise", () => {
    expect(browserLanguage(["fr-CA", "en"])).toBe("fr");
    expect(browserLanguage(["de-DE", "EN-gb"])).toBe("en");
    expect(browserLanguage(["es", "de"])).toBe("en");
    expect(browserLanguage([])).toBe("en");
  });

  it("prefers the stored choice over the browser", () => {
    const storage = memory();
    expect(loadLanguage(() => storage, ["fr"])).toEqual({ ok: true, value: "fr" });
    expect(saveLanguage(() => storage, "en")).toEqual({ ok: true, value: null });
    expect(loadLanguage(() => storage, ["fr"])).toEqual({ ok: true, value: "en" });
  });

  it("ignores an unknown stored value", () => {
    const storage = memory();
    storage.setItem("openlinguo.language", "de");
    expect(loadLanguage(() => storage, ["fr-FR"])).toEqual({ ok: true, value: "fr" });
  });

  it("reports an unavailable storage", () => {
    expect(loadLanguage(unavailable, ["fr"]).ok).toBe(false);
    expect(saveLanguage(unavailable, "fr").ok).toBe(false);
  });
});
