import { err, inMemoryDictionary, type DecompositionNode, type DictEntry } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { componentsOf, createDecomposition } from "./decomposition.ts";
import { loadDecompositions } from "./testing/dataset-shards.ts";

const entry = (headword: string, ...glosses: readonly string[]): DictEntry => ({
  headword,
  variants: [],
  reading: null,
  glosses: glosses.map((text) => ({ lang: "en", text })),
  level: null,
});

const lookup = inMemoryDictionary([
  entry("电话", "telephone"),
  entry("电", "electric"),
  entry("话", "dialect", "speech"),
  entry("话", "speech"),
  entry("讠", "speech radical"),
  entry("舌", "tongue"),
  entry("曰", "to speak"),
]);

const decompositions = new Map([
  ["电", "⿻曰乚"],
  ["话", "⿰讠舌"],
  ["讠", "⿻？？"],
  ["器", "⿳⿰口口犬⿰口口"],
]);

const outline = (node: DecompositionNode): string =>
  `${node.form}(${node.children.map(outline).join(" ")})`;

describe("componentsOf", () => {
  it("keeps distinct components in order and leaves out operators and unknown parts", () => {
    expect(componentsOf("⿳⿰口口犬⿰口口")).toEqual(["口", "犬"]);
    expect(componentsOf("⿰⿱？谷又")).toEqual(["谷", "又"]);
    expect(componentsOf("？")).toEqual([]);
  });
});

describe("createDecomposition", () => {
  const { decompose } = createDecomposition(lookup, decompositions);

  it("breaks 电话 into 电 + 话 and their components", async () => {
    const tree = await decompose("电话");
    if (!tree.ok) throw new Error(tree.error.kind);
    expect(outline(tree.value)).toBe("电话(电(曰() 乚()) 话(讠() 舌()))");
    expect(tree.value.glosses).toEqual([{ lang: "en", text: "telephone" }]);
  });

  it("decomposes a single character into its components, with every distinct gloss", async () => {
    const tree = await decompose("话");
    if (!tree.ok) throw new Error(tree.error.kind);
    expect(outline(tree.value)).toBe("话(讠() 舌())");
    expect(tree.value.glosses.map(({ text }) => text)).toEqual(["dialect", "speech"]);
    expect(tree.value.children[1]?.glosses).toEqual([{ lang: "en", text: "tongue" }]);
  });

  it("keeps a component without dictionary entry or known parts as a bare leaf", async () => {
    const tree = await decompose("电");
    expect(tree.ok && tree.value.children[1]).toEqual({ form: "乚", glosses: [], children: [] });
    const radical = await decompose("讠");
    expect(radical.ok && radical.value.children).toEqual([]);
  });

  it("lists each component of a nested description once", async () => {
    const tree = await decompose("器");
    expect(tree.ok && outline(tree.value)).toBe("器(口() 犬())");
  });

  it("returns the dictionary failure", async () => {
    const failing = createDecomposition(
      () => Promise.resolve(err({ kind: "dataset-missing", dataset: "cc-cedict" })),
      decompositions,
    );
    expect(await failing.decompose("电话")).toEqual(
      err({ kind: "dataset-missing", dataset: "cc-cedict" }),
    );
  });

  it("breaks 电话 down with the shipped Make Me a Hanzi data", async () => {
    const shipped = new Map(
      (await loadDecompositions()).map(([character, ids]) => [character, ids] as const),
    );
    const tree = await createDecomposition(lookup, shipped).decompose("电话");
    expect(tree.ok && outline(tree.value)).toBe("电话(电(曰() 乚()) 话(讠() 舌()))");
  });
});
