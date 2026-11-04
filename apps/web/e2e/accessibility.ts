import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** WCAG 2.0, 2.1 and 2.2 levels A and AA (ADR 0008), plus axe best practices. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** The axe violations of the page as it is now, one readable line each. */
export const accessibilityViolations = async (page: Page): Promise<readonly string[]> => {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // axe finishes its run in a blank page of this context: WebKit leaves this one without focus.
  await page.bringToFront();
  return violations.map(
    ({ id, impact, help, nodes }) =>
      `${id} (${impact ?? "no impact"}): ${help} at ${nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
};

/** Text with Han characters whose nearest `lang` is not Chinese: a screen reader reads it with the wrong voice. */
export const chineseOutsideZh = (page: Page): Promise<readonly string[]> =>
  page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      const parent = node.parentElement;
      if (parent === null || !/\p{Script=Han}/u.test(text)) continue;
      if (parent.closest("script, style, noscript") !== null || !parent.checkVisibility()) continue;
      const lang = parent.closest("[lang]")?.getAttribute("lang") ?? "";
      if (!/^zh(-|$)/i.test(lang)) {
        found.push(`${parent.tagName.toLowerCase()} lang="${lang}": ${text.trim().slice(0, 20)}`);
      }
    }
    return found;
  });

/** WCAG 1.4.10: how many pixels the page scrolls sideways. */
export const horizontalOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Animations still running, for a page under `prefers-reduced-motion: reduce`. */
export const runningAnimations = (page: Page): Promise<readonly string[]> =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter(({ playState }) => playState === "running")
      .map((animation) => animation.constructor.name),
  );

const MAX_TAB_STOPS = 500;

/** Presses Tab through the page: stops without a focus indicator, and a trap if Tab never comes back around. */
export const focusProblems = async (page: Page): Promise<readonly string[]> => {
  const problems: string[] = [];
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let stops = 0; stops < MAX_TAB_STOPS; stops += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) return null;
      if (element.hasAttribute("data-tab-visited")) return null;
      element.setAttribute("data-tab-visited", "");
      const style = getComputedStyle(element);
      const outlined = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
      const label = element.getAttribute("aria-label") ?? element.textContent;
      return {
        name: `${element.tagName.toLowerCase()} ${label.trim().slice(0, 30)}`,
        indicated: outlined || style.boxShadow !== "none",
      };
    });
    if (stop === null) return problems;
    if (!stop.indicated) problems.push(`no focus indicator on ${stop.name}`);
  }
  return [
    ...problems,
    `Tab still moves after ${String(MAX_TAB_STOPS)} stops: a trap or an endless list`,
  ];
};
