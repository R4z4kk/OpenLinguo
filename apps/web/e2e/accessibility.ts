import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** WCAG 2.0, 2.1 and 2.2 levels A and AA (ADR 0008), plus axe best practices. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** The axe violations of the page as it is now, one readable line each. */
export const accessibilityViolations = async (page: Page): Promise<readonly string[]> => {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.map(
    ({ id, impact, help, nodes }) =>
      `${id} (${impact ?? "no impact"}): ${help} at ${nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
};
