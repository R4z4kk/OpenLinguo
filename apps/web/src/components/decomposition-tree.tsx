import type {
  DecompositionFeature,
  DecompositionNode,
  LookupError,
  Result,
} from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { Minus, Plus } from "lucide-react";
import { Suspense, use, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@/i18n/language";
import { GlossSummary } from "./gloss-summary.tsx";

type Decomposed = Promise<Result<DecompositionNode, LookupError>>;

type Context = {
  readonly decompose: DecompositionFeature["decompose"];
  readonly language: Language;
  /** Depth of the components: below it a node is a word's character. */
  readonly componentDepth: number;
};

const Children = ({
  nodes,
  depth,
  context,
}: {
  readonly nodes: readonly DecompositionNode[];
  readonly depth: number;
  readonly context: Context;
}) => (
  <ul className="ml-3 border-l border-hairline pl-4">
    {nodes.map((child, index) => (
      // A word may repeat a character (谢谢): the position is part of the key.
      <Node key={`${String(index)}${child.form}`} node={child} depth={depth} context={context} />
    ))}
  </ul>
);

const Expansion = ({
  decomposed,
  depth,
  context,
}: {
  readonly decomposed: Decomposed;
  readonly depth: number;
  readonly context: Context;
}) => {
  const { t } = useTranslation();
  const result = use(decomposed);
  if (!result.ok) {
    return (
      <p role="alert" className="text-danger">
        {t("word.decompositionFailed")}
      </p>
    );
  }
  if (result.value.children.length === 0) {
    return <p className="ml-7 text-small text-muted">{t("word.noComponents")}</p>;
  }
  return <Children nodes={result.value.children} depth={depth} context={context} />;
};

const Node = ({
  node,
  depth,
  context,
}: {
  readonly node: DecompositionNode;
  readonly depth: number;
  readonly context: Context;
}) => {
  const { t } = useTranslation();
  const [decomposed, setDecomposed] = useState<Decomposed | null>(null);
  const expandable = depth >= context.componentDepth && node.children.length === 0;
  const form =
    depth > 0 && node.glosses.length > 0 ? (
      <Link to="/learn/dictionary/$word" params={{ word: node.form }} className="hover:underline">
        {node.form}
      </Link>
    ) : (
      node.form
    );
  return (
    <li className="py-1">
      <div className="flex min-h-11 items-center gap-3">
        {expandable && (
          <button
            type="button"
            aria-expanded={decomposed !== null}
            aria-label={t("word.decompose", { form: node.form })}
            onClick={() => {
              setDecomposed(decomposed === null ? context.decompose(node.form) : null);
            }}
            className="flex size-11 shrink-0 items-center justify-center rounded-control border border-border-strong bg-surface hover:bg-sunken"
          >
            {decomposed === null ? (
              <Plus aria-hidden="true" className="size-4" />
            ) : (
              <Minus aria-hidden="true" className="size-4" />
            )}
          </button>
        )}
        <span lang="zh-Hans" className="font-display text-title font-normal">
          {form}
        </span>
        <GlossSummary glosses={node.glosses} language={context.language} className="text-small" />
      </div>
      {node.children.length > 0 && (
        <Children nodes={node.children} depth={depth + 1} context={context} />
      )}
      {decomposed !== null && (
        <Suspense fallback={null}>
          <Expansion decomposed={decomposed} depth={depth + 1} context={context} />
        </Suspense>
      )}
    </li>
  );
};

type Props = {
  readonly root: DecompositionNode;
  readonly decompose: DecompositionFeature["decompose"];
  readonly language: Language;
};

/**
 * Word → characters → components as a nested list: the tree and its text alternative are the
 * same markup. A component is decomposed further on demand.
 */
export const DecompositionTree = ({ root, decompose, language }: Props) => (
  <ul>
    <Node
      node={root}
      depth={0}
      context={{
        decompose,
        language,
        componentDepth: Array.from(root.form).length === 1 ? 1 : 2,
      }}
    />
  </ul>
);
