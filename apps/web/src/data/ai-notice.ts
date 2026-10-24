import {
  ok,
  type AiProvider,
  type CorrectionInput,
  type GlossInput,
  type Result,
  type StoryInput,
  type VocabularyInput,
} from "@openlinguo/core";
import type { TFunction } from "i18next";
import type { Database } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export type AiFeature = "challenge" | "journal" | "interests" | "translation" | "story";

/** The input the feature's PromptTask builds its request from. */
export type AiPayload =
  | { readonly feature: "challenge" | "journal"; readonly input: CorrectionInput }
  | {
      readonly feature: "interests";
      readonly input: VocabularyInput;
      /** The level sent, as the learner reads it: « HSK 2 ». */
      readonly band: string;
    }
  | { readonly feature: "translation"; readonly input: GlossInput }
  | { readonly feature: "story"; readonly input: StoryInput; readonly band: string };

/** One AI button: what its click sends, and where. */
export type AiCall = {
  readonly provider: AiProvider;
  /** The button's label. */
  readonly action: string;
  readonly payload: AiPayload;
};

/** The one notice before the first AI call of any kind (ADR 0012). */
export const noticeSeen = (db: Database): Promise<Result<boolean, ReviewLogFailure>> =>
  guarded(async () => ok((await db.aiNotice.get("seen")) != null));

export const markNoticeSeen = (db: Database): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.aiNotice.put({ id: "seen" });
    return ok(null);
  });

/** The words a story sends, as the sent line writes them. */
export const storyWords = (words: readonly string[]): string => words.join("、");

const itemsOf = (t: TFunction, payload: AiPayload): string[] => {
  const { feature, input } = payload;
  switch (feature) {
    case "challenge":
    case "journal":
      return [
        ...(input.word === null ? [] : [t("aiNotice.items.word")]),
        feature === "journal"
          ? t("aiNotice.items.entry")
          : t("aiNotice.items.sentences", { count: input.sentences.length }),
        t("aiNotice.items.language"),
      ];
    case "interests":
      return [
        ...(input.themes.length === 0 ? [] : [t("aiNotice.items.themes")]),
        ...(input.note.trim() === "" ? [] : [t("aiNotice.items.note")]),
        t("aiNotice.items.level", { band: payload.band }),
      ];
    case "translation":
      return [
        t("aiNotice.items.word"),
        t("aiNotice.items.reading"),
        t("aiNotice.items.senses", { count: input.glosses.length }),
      ];
    case "story":
      return [
        t("aiNotice.items.level", { band: payload.band }),
        t("aiNotice.items.storyTheme", { theme: input.theme }),
        t(input.length === "short" ? "aiNotice.items.storyShort" : "aiNotice.items.storyMedium"),
        ...(input.words.length === 0
          ? []
          : [
              t("aiNotice.items.storyWords", {
                count: input.words.length,
                words: storyWords(input.words),
              }),
            ]),
      ];
  }
};

/** The learner's data a call sends, read from the payload itself, as one phrase. */
export const sentItems = (t: TFunction, language: string, payload: AiPayload): string =>
  new Intl.ListFormat(language, { type: "conjunction" }).format(itemsOf(t, payload));
