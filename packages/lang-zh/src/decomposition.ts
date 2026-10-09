import {
  ok,
  type DecompositionFeature,
  type DecompositionNode,
  type DictionaryLookup,
  type Gloss,
  type LookupError,
  type Result,
} from "@openlinguo/core";

const IDS_OPERATOR = /^[⿰-⿻]$/u;
const UNKNOWN_COMPONENT = "？";

/** Distinct components of an ideographic description sequence, in order, unknown ones left out. */
export const componentsOf = (ids: string): readonly string[] => [
  ...new Set(
    Array.from(ids).filter((char) => !IDS_OPERATOR.test(char) && char !== UNKNOWN_COMPONENT),
  ),
];

const collect = async <T>(
  pending: readonly Promise<Result<T, LookupError>>[],
): Promise<Result<readonly T[], LookupError>> => {
  const values: T[] = [];
  for (const result of await Promise.all(pending)) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};

/**
 * Word → characters → components, one level of components per character; a component is
 * decomposed further by calling `decompose` on it. Glosses are those of every dictionary entry.
 */
export const createDecomposition = (
  lookup: DictionaryLookup,
  decompositions: ReadonlyMap<string, string>,
): DecompositionFeature => {
  const node = async (
    form: string,
    children: readonly DecompositionNode[],
  ): Promise<Result<DecompositionNode, LookupError>> => {
    const entries = await lookup(form);
    if (!entries.ok) return entries;
    const glosses = new Map<string, Gloss>();
    for (const gloss of entries.value.flatMap((entry) => entry.glosses)) {
      glosses.set(`${gloss.lang}\t${gloss.text}`, gloss);
    }
    return ok({ form, glosses: [...glosses.values()], children });
  };

  const character = async (char: string): Promise<Result<DecompositionNode, LookupError>> => {
    const components = componentsOf(decompositions.get(char) ?? "").filter((part) => part !== char);
    const children = await collect(components.map((component) => node(component, [])));
    return children.ok ? node(char, children.value) : children;
  };

  return {
    decompose: async (word) => {
      const characters = Array.from(word);
      if (characters.length === 1) return character(word);
      const children = await collect(characters.map((char) => character(char)));
      return children.ok ? node(word, children.value) : children;
    },
  };
};
