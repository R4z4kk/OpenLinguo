import { describe, expect, it } from "vitest";
import { cn } from "./utils.ts";

describe("cn", () => {
  it("keeps a design-system text size next to a text color", () => {
    expect(cn("text-body text-ink", "text-small")).toBe("text-ink text-small");
  });
});
