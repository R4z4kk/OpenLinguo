import { describe, expect, it } from "vitest";
import { decompositionOutline } from "./decomposition.ts";
import type { DecompositionNode } from "./language-pack.ts";

const leaf = (form: string): DecompositionNode => ({
  form,
  glosses: [{ lang: "en", text: form, source: "test" }],
  children: [],
});

describe("decompositionOutline", () => {
  it("lists the tree depth-first with each depth", () => {
    const tree: DecompositionNode = {
      form: "电话",
      glosses: [],
      children: [
        { ...leaf("电"), children: [leaf("曰"), leaf("乚")] },
        { ...leaf("话"), children: [leaf("讠")] },
      ],
    };
    expect(decompositionOutline(tree).map(({ depth, form }) => `${String(depth)} ${form}`)).toEqual(
      ["0 电话", "1 电", "2 曰", "2 乚", "1 话", "2 讠"],
    );
  });
});
