import { describe, expect, it } from "vitest";
import { localeOf, signInCodeMail } from "./mail-templates.ts";

describe("localeOf", () => {
  it("picks French for a French first language, English otherwise", () => {
    expect(localeOf("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(localeOf("FR")).toBe("fr");
    expect(localeOf("en-GB,fr;q=0.5")).toBe("en");
    expect(localeOf(null)).toBe("en");
  });
});

describe("signInCodeMail", () => {
  it("writes the code and its 10 minutes in French and in English", () => {
    const fr = signInCodeMail("fr", "a@example.test", "123456");
    expect(fr.to).toBe("a@example.test");
    expect(fr.subject).toBe("Votre code OpenLinguo : 123456");
    expect(fr.text).toContain("123456");
    expect(fr.text).toContain("10 minutes");
    const en = signInCodeMail("en", "a@example.test", "123456");
    expect(en.subject).toBe("Your OpenLinguo code: 123456");
    expect(en.text).toContain("10 minutes");
  });
});
