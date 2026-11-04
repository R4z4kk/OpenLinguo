import { TERMS_CLAUSES } from "@openlinguo/core/moderation";
import { describe, expect, it } from "vitest";
import { TERMS } from "./terms.tsx";

describe("terms", () => {
  it.each(["fr", "en"] as const)(
    "numbers the library rules after the section that holds them (%s)",
    (language) => {
      const position = TERMS[language].sections.findIndex(({ id }) => id === "rules") + 1;
      expect(position).toBeGreaterThan(0);
      for (const clause of Object.values(TERMS_CLAUSES)) {
        expect(clause.split(".")[0]).toBe(String(position));
      }
    },
  );
});
