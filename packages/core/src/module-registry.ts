import type { FeatureName, LanguageFeatures, LanguagePack } from "./language-pack.ts";
import type { PromptPack } from "./prompt-pack.ts";

export type Requirement = FeatureName | "prompts";

export type PackWith<R extends Requirement> = LanguagePack & {
  readonly features: {
    readonly [K in Extract<R, FeatureName>]: NonNullable<LanguageFeatures[K]>;
  };
} & ("prompts" extends R ? { readonly prompts: PromptPack } : unknown);

export type ModuleDefinition = {
  readonly id: string;
  readonly requires: readonly Requirement[];
};

export const hasFeatures = <R extends Requirement>(
  pack: LanguagePack,
  required: readonly R[],
): pack is PackWith<R> =>
  required.every((requirement: Requirement) =>
    requirement === "prompts" ? pack.prompts !== null : pack.features[requirement] !== null,
  );

export const supportedModules = <M extends ModuleDefinition>(
  pack: LanguagePack,
  modules: readonly M[],
): readonly M[] => modules.filter((definition) => hasFeatures(pack, definition.requires));
