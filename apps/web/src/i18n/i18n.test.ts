import { describe, expect, it } from "vitest";
import type { Messages } from "./en.ts";
import { fr } from "./fr.ts";
import { bindDocumentLanguage, createI18n } from "./index.ts";

describe("i18n", () => {
  it("translates in the chosen language with interpolation", () => {
    const i18n = createI18n("fr");
    expect(i18n.t("nav.today")).toBe("Aujourd’hui");
    expect(i18n.t("update.offlineUnavailable", { reason: "x" })).toBe(
      "Le mode hors ligne est indisponible : x",
    );
  });

  it("keeps the document lang in step with the language", async () => {
    const i18n = createI18n("en");
    const element = { lang: "" };
    bindDocumentLanguage(i18n, element);
    expect(element.lang).toBe("en");
    await i18n.changeLanguage("fr");
    expect(element.lang).toBe("fr");
  });

  it("rejects unknown keys and incomplete catalogs at typecheck", () => {
    const i18n = createI18n("en");
    // @ts-expect-error unknown key
    expect(i18n.t("nav.missing")).toBe("nav.missing");
    // @ts-expect-error a catalog must have every key of `en`
    const incomplete: Messages["nav"] = { today: "", learn: "", read: "" };
    expect(Object.keys(incomplete)).not.toContain("profile");
    expect(Object.keys(fr.nav)).toContain("profile");
  });
});
