import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@/i18n/index";
import { markNoticeSeen, noticeSeen, sentItems } from "./ai-notice.ts";
import { openDatabase, type Database } from "./database.ts";

const fr = createI18n("fr").t;
const en = createI18n("en").t;

const SENTENCES = [
  "我给妈妈打电话。",
  "你的电话号码是多少？",
  "我电话很新。",
  "晚上我不想接电话。",
  "请你电话我。",
];

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`ai-notice-test-${String(counter)}`);
});

describe("first-use notices", () => {
  it("remembers each feature on its own", async () => {
    expect(await noticeSeen(db, "journal")).toEqual({ ok: true, value: false });
    expect(await markNoticeSeen(db, "journal")).toEqual({ ok: true, value: null });
    expect(await noticeSeen(db, "journal")).toEqual({ ok: true, value: true });
    expect(await noticeSeen(db, "challenge")).toEqual({ ok: true, value: false });
  });

  it("reports a storage failure instead of throwing", async () => {
    vi.spyOn(db.aiNotices, "put").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await markNoticeSeen(db, "interests")).toEqual({
      ok: false,
      error: { kind: "storage", message: "Error: QuotaExceededError" },
    });
    db.close();
    expect(await noticeSeen(db, "interests")).toMatchObject({
      ok: false,
      error: { kind: "storage" },
    });
  });
});

describe("sentItems", () => {
  it("lists what a correction sends, from its input", () => {
    const challenge = { word: "电话", sentences: SENTENCES, language: "fr" } as const;
    expect(sentItems(fr, "fr", { feature: "challenge", input: challenge })).toBe(
      "le mot, vos 5 phrases et la langue de l’interface",
    );
    expect(
      sentItems(en, "en", {
        feature: "challenge",
        input: { ...challenge, sentences: SENTENCES.slice(0, 1), language: "en" },
      }),
    ).toBe("the word, your sentence, and the interface language");
    expect(
      sentItems(fr, "fr", {
        feature: "journal",
        input: { word: null, sentences: SENTENCES, language: "fr" },
      }),
    ).toBe("le texte de cette entrée et la langue de l’interface");
  });

  it("leaves out the interests the learner did not give and names the band", () => {
    const input = { themes: ["Cuisine"], note: "J’aime le thé.", level: 2, count: 10 };
    const payload = { feature: "interests", input, band: "HSK 2" } as const;
    expect(sentItems(fr, "fr", payload)).toBe(
      "les thèmes cochés, votre phrase et votre niveau (HSK 2)",
    );
    expect(sentItems(fr, "fr", { ...payload, input: { ...input, note: " " } })).toBe(
      "les thèmes cochés et votre niveau (HSK 2)",
    );
    expect(sentItems(en, "en", { ...payload, input: { ...input, themes: [] } })).toBe(
      "your sentence and your level (HSK 2)",
    );
  });

  it("counts the English senses a translation sends", () => {
    const input = {
      headword: "一路平安",
      reading: "yi1 lu4 ping2 an1",
      glosses: ["to have a pleasant journey", "Bon voyage!"],
    };
    expect(sentItems(fr, "fr", { feature: "translation", input })).toBe(
      "le mot, son pinyin et ses 2 sens anglais",
    );
    expect(
      sentItems(en, "en", { feature: "translation", input: { ...input, glosses: ["bon voyage"] } }),
    ).toBe("the word, its pinyin, and its English sense");
  });
});
