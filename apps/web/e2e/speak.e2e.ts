import { F0_VERSION } from "@openlinguo/core";
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

/** Counts the clips played on the speakers in `data-played` (offline rendering is not playing). */
const countPlayback = async (page: Page): Promise<void> => {
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

/** A kept recording of 你好, a tenth of a second of silence, as Say it stores one. */
const storeRecording = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction("recordings", "readwrite");
          transaction.objectStore("recordings").put({
            id: "你好\tni3 hao3",
            headword: "你好",
            readingKey: "ni3 hao3",
            recordedAt: 1,
            sampleRate: 16_000,
            data: new Int16Array(1_600).buffer,
          });
          transaction.onabort = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
  );

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

/** Stores a flat pitch contour of `version` with the recording of 上学, as a pack would. */
const storeFlatContour = (page: Page, version: string): Promise<void> =>
  page.evaluate(
    (version) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction("wordAudio", "readwrite");
          const store = transaction.objectStore("wordAudio");
          const read = store.get("上学\tshang4 xue2");
          read.onsuccess = () => {
            const row: unknown = read.result;
            if (typeof row !== "object" || row === null) {
              transaction.abort();
              return;
            }
            store.put({ ...row, f0: Array.from({ length: 20 }, () => 0), f0Version: version });
          };
          transaction.onabort = () => {
            reject(new Error(String(transaction.error ?? "no recording of 上学 stored")));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    version,
  );

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

test("shadows a word: model then voice, kept on the device, keys only in the section", async ({
  page,
}) => {
  await fakeMicrophone(page, "word");
  await countPlayback(page);
  await openWord(page);
  const main = page.getByRole("main");
  const root = page.locator("html");
  await page.keyboard.press("r");
  await page.waitForTimeout(500);
  await expect(main.getByText(en.speak.recording)).toHaveCount(0);

  const record = main.getByRole("button", { name: en.speak.record });
  await expect(record).toHaveAttribute("aria-keyshortcuts", "R");
  await record.focus();
  await page.keyboard.press("r");
  await expect(main.getByRole("status").getByRole("listitem")).toHaveCount(2, { timeout: 15_000 });

  const compare = main.getByRole("button", { name: en.speak.compare.said });
  await expect(compare).toHaveAttribute("aria-keyshortcuts", "A");
  await main.getByRole("button", { name: en.speak.again }).focus();
  await page.keyboard.press("a");
  await expect(main.getByRole("button", { name: en.speak.stopPlaying })).toBeVisible();
  await expect(root).toHaveAttribute("data-played", "2");
  await expect(compare).toBeVisible({ timeout: 10_000 });

  await main.getByRole("button", { name: en.speak.keep }).click();
  await expect(main.getByText(en.speak.keptNotice)).toBeVisible();
  await expect(main.getByRole("button", { name: en.speak.keep })).toHaveCount(0);
  await expect(main.getByRole("button", { name: en.speak.compare.kept })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.reload();
  const kept = main.getByRole("button", { name: en.speak.compare.kept });
  await expect(kept).toHaveAttribute("aria-keyshortcuts", "A");
  await kept.click();
  await expect(root).toHaveAttribute("data-played", "2");
  await expect(kept).toBeVisible({ timeout: 10_000 });
  await main.getByRole("button", { name: en.speak.deleteKept }).click();
  await expect(main.getByText(en.speak.keptDeleted)).toBeVisible();
  await expect(kept).toHaveCount(0);
  await expect(main.getByRole("heading", { name: en.speak.title })).toBeFocused();
});

test("lists kept recordings in Profile: size, play, delete one, delete all", async ({ page }) => {
  await fakeMicrophone(page, "word");
  await countPlayback(page);
  await openWord(page);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: en.speak.record }).click();
  await main.getByRole("button", { name: en.speak.keep }).click();
  await expect(main.getByText(en.speak.keptNotice)).toBeVisible();
  await storeRecording(page);

  await page.goto("/profile");
  const heading = main.getByRole("heading", { name: en.recordings.title });
  await expect(main.getByText(/^2 recordings, [\d.]+ kB$/u)).toBeVisible();
  const rows = main
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: en.recordings.play }) });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("上学");
  expect(await accessibilityViolations(page)).toEqual([]);

  await rows.first().getByRole("button", { name: en.recordings.play }).click();
  await expect(page.locator("html")).toHaveAttribute("data-played", "1");

  await rows.nth(1).getByRole("button", { name: en.recordings.delete }).click();
  await expect(main.getByText("Recording of 你好 deleted.")).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(heading).toBeFocused();

  await main.getByRole("button", { name: en.recordings.deleteAll }).click();
  const dialog = page.getByRole("dialog", { name: en.recordings.deleteAllTitle });
  await expect(dialog).toContainText("1 recording will be deleted from this device.");
  expect(await accessibilityViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: en.recordings.deleteAll }).click();
  await expect(main.getByText(en.recordings.none)).toBeVisible();
  await expect(main.getByText(en.recordings.allDeleted)).toBeVisible();
  await expect(heading).toBeFocused();
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

test("draws the pack's contour only when this app's contour code made it", async ({ page }) => {
  await openWord(page);
  const reference = page
    .getByRole("main")
    .getByRole("img", { name: en.speak.chart })
    .locator("path");

  await storeFlatContour(page, F0_VERSION);
  await page.reload();
  await expect(reference).toHaveCount(1);
  await expect(reference).toHaveAttribute("d", /^M5\.0 50\.0h0\.1(L\d+\.0 50\.0){19}$/u);

  await storeFlatContour(page, "pitchy-0.0.0/v0");
  await page.reload();
  await expect(reference).toHaveCount(1);
  await expect(reference).toHaveAttribute("d", / (?!50\.0)\d+\.\d/u);
});
