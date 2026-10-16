import type { Page } from "@playwright/test";

/** Counts the clips played on the speakers in `data-played` (offline rendering is not playing). */
export const countPlayback = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called below with the node as `this`.
    const start = AudioBufferSourceNode.prototype.start;
    Object.defineProperty(AudioBufferSourceNode.prototype, "start", {
      configurable: true,
      value: function played(this: AudioBufferSourceNode, ...args: [number?]) {
        if (this.context instanceof AudioContext) {
          const root = document.documentElement;
          root.dataset["played"] = String(Number(root.dataset["played"] ?? "0") + 1);
        }
        start.apply(this, args);
      },
    });
  });
};
