import type { FeatureName, LanguageFeatures, LanguagePack } from "./language-pack.ts";

export type PackWith<F extends FeatureName> = LanguagePack & {
  readonly features: { readonly [K in F]: NonNullable<LanguageFeatures[K]> };
};

export type ModuleDefinition = {
  readonly id: string;
  readonly requires: readonly FeatureName[];
};

export const hasFeatures = <F extends FeatureName>(
  pack: LanguagePack,
  required: readonly F[],
): pack is PackWith<F> => required.every((feature) => pack.features[feature] !== null);

export const supportedModules = <M extends ModuleDefinition>(
  pack: LanguagePack,
  modules: readonly M[],
): readonly M[] => modules.filter((definition) => hasFeatures(pack, definition.requires));
