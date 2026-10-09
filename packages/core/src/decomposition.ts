import type { DecompositionNode, Gloss } from "./language-pack.ts";

export type OutlineItem = {
  readonly depth: number;
  readonly form: string;
  readonly glosses: readonly Gloss[];
};

/** Depth-first list of a decomposition tree: the text alternative of its diagram. */
export const decompositionOutline = (root: DecompositionNode): readonly OutlineItem[] => {
  const walk = (node: DecompositionNode, depth: number): readonly OutlineItem[] => [
    { depth, form: node.form, glosses: node.glosses },
    ...node.children.flatMap((child) => walk(child, depth + 1)),
  ];
  return walk(root, 0);
};
