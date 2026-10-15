import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

/** What the fake microphone does: a falling then rising voice and quiet, or a voice that goes on. */
type Voice = "word" | "endless" | "denied";

/**
 * Replaces the microphone with a synthetic voice (no device in CI); counts the tracks stopped in
 * `data-stopped`, so the test sees the microphone released. Patched on the prototypes: WebKit ignores
 * an assignment to `navigator.mediaDevices.getUserMedia` and keeps a track's own `stop`.
 */
const fakeMicrophone = async (page: Page, voice: Voice): Promise<void> => {
  await page.addInitScript((voice: Voice) => {
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    const getUserMedia = (): Promise<MediaStream> => {
      if (voice === "denied") return Promise.reject(new DOMException("", "NotAllowedError"));
      const context = new AudioContext();
      const source = context.createOscillator();
      const gain = context.createGain();
      const output = context.createMediaStreamDestination();
      const at = context.currentTime + 0.3;
      source.type = "sawtooth";
      source.frequency.setValueAtTime(240, at);
      source.frequency.linearRampToValueAtTime(170, at + 0.4);
      source.frequency.linearRampToValueAtTime(240, at + 0.8);
      gain.gain.setValueAtTime(0, 0);
      gain.gain.setValueAtTime(0.3, at);
      if (voice === "word") gain.gain.setValueAtTime(0, at + 0.8);
      source.connect(gain).connect(output);
      source.start();
      return Promise.resolve(output.stream);
    };
    Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
      configurable: true,
      value: getUserMedia,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called below with the track as `this`.
    const stopTrack = MediaStreamTrack.prototype.stop;
    Object.defineProperty(MediaStreamTrack.prototype, "stop", {
      configurable: true,
      value: function stop(this: MediaStreamTrack) {
        const root = document.documentElement;
        root.dataset["stopped"] = String(Number(root.dataset["stopped"] ?? "0") + 1);
        stopTrack.call(this);
      },
    });
  }, voice);
};

/** The HSK 1 audio, then the word page of 上学 shàngxué. */
const openWord = async (page: Page): Promise<void> => {
  const main = page.getByRole("main");
  await page.goto("/learn");
  const download = main.getByRole("button", { name: /^Download the audio \(/ }).first();
  await expect(download).toBeVisible({ timeout: 90_000 });
  await download.click();
  await expect(main.getByText(en.audio.installed).first()).toBeVisible();
  await page.goto(`/learn/dictionary/${encodeURIComponent("上学")}`);
  await expect(main.getByRole("heading", { name: en.speak.title })).toBeVisible();
};

test.beforeEach(({ browserName }) => {
  test.skip(
    process.platform === "win32" && browserName === "webkit",
    "WebKit for Windows has no Web Audio; CI runs this on Linux",
  );
});

test("says a word: a result per syllable as text, then the microphone is released", async ({
  page,
}) => {
  await fakeMicrophone(page, "word");
  await openWord(page);
  const main = page.getByRole("main");
  await expect(main.getByText(en.speak.notice)).toBeVisible();
  const chart = main.getByRole("img", { name: en.speak.chart });
  await expect(chart.locator("path")).toHaveCount(1);
  expect(await accessibilityViolations(page)).toEqual([]);

  await main.getByRole("button", { name: en.speak.record }).click();
  const results = main.getByRole("status").getByRole("listitem");
  await expect(results).toHaveCount(2, { timeout: 15_000 });
  await expect(results.first()).toContainText(/^shang: .+à 4.*; [\d.]+ semitones from the model$/u);
  await expect(results.nth(1)).toContainText(/^xue: .+; [\d.]+ semitones from the model$/u);
  await expect(chart.locator("path")).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute("data-stopped", "1");
  await expect(main.getByRole("button", { name: en.speak.again })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("draws the voice live, or only once stopped under reduced motion", async ({ page }) => {
  await fakeMicrophone(page, "endless");
  await openWord(page);
  const main = page.getByRole("main");
  const chart = main.getByRole("img", { name: en.speak.chart });
  const stop = main.getByRole("button", { name: en.speak.stop });

  await main.getByRole("button", { name: en.speak.record }).click();
  await expect(main.getByRole("status")).toContainText(en.speak.recording);
  await expect(chart.locator("path")).toHaveCount(2);
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(main.getByRole("status").getByRole("listitem")).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute("data-stopped", "1");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await main.getByRole("button", { name: en.speak.again }).click();
  await expect(stop).toBeVisible();
  await expect(chart.locator("path")).toHaveCount(1);
  await page.waitForTimeout(1_000);
  await expect(chart.locator("path")).toHaveCount(1);
  await stop.click();
  await expect(chart.locator("path")).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute("data-stopped", "2");
});

test("explains a blocked microphone and keeps the listening mode", async ({ page }) => {
  await fakeMicrophone(page, "denied");
  await openWord(page);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: en.speak.record }).click();
  await expect(main.getByRole("status")).toContainText(en.speak.microphone.denied);

  const listen = main.getByRole("button", { name: en.speak.listenInstead });
  await listen.click();
  await expect(listen).toHaveAttribute("aria-expanded", "true");
  await main.getByRole("radio", { name: "ā 1" }).first().focus();
  await page.keyboard.press("4");
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await expect(main.getByText("Right: à 4")).toBeVisible();
  await expect(main.getByText(/^Graded/u)).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
});
