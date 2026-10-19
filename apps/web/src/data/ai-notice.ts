import {
  ok,
  type AiProvider,
  type CorrectionInput,
  type GlossInput,
  type Result,
  type VocabularyInput,
} from "@openlinguo/core";
import type { TFunction } from "i18next";
import type { Database } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** Each has its own first-use notice (ADR 0012). */
export const AI_FEATURES = ["challenge", "journal", "interests", "translation"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** The input the feature's PromptTask builds its request from. */
export type AiPayload =
  | { readonly feature: "challenge" | "journal"; readonly input: CorrectionInput }
  | { readonly feature: "interests"; readonly input: VocabularyInput }
  | { readonly feature: "translation"; readonly input: GlossInput };

/** One AI button: what its click sends, and where. */
export type AiCall = {
  readonly provider: AiProvider;
  /** The button's label. */
  readonly action: string;
  readonly payload: AiPayload;
};

export const noticeSeen = (
  db: Database,
  feature: AiFeature,
): Promise<Result<boolean, ReviewLogFailure>> =>
  guarded(async () => ok((await db.aiNotices.get(feature)) != null));

export const markNoticeSeen = (
  db: Database,
  feature: AiFeature,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.aiNotices.put({ feature });
    return ok(null);
  });

const itemsOf = (t: TFunction, { feature, input }: AiPayload): string[] => {
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
        t("aiNotice.items.level"),
      ];
    case "translation":
      return [
        t("aiNotice.items.word"),
        t("aiNotice.items.reading"),
        t("aiNotice.items.senses", { count: input.glosses.length }),
      ];
  }
};

/** The learner's data a call sends, read from the payload itself, as one phrase. */
export const sentItems = (t: TFunction, language: string, payload: AiPayload): string =>
  new Intl.ListFormat(language, { type: "conjunction" }).format(itemsOf(t, payload));
