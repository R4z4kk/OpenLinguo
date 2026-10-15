import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const SENTENCE = "我们一起去吃饭吧";

/**
 * Replaces the microphone with a recording of the sentence (the self-check one, data/whisper), played once
 * after 0.3 s of silence; the stream stays silent afterwards, so the recording stops by itself.
 * Patched on the prototype: WebKit ignores an assignment to `navigator.mediaDevices.getUserMedia`.
 * The recording comes with the script: in WebKit, a request from a page the service worker controls
 * escapes `page.route`.
 */
const fakeMicrophone = async (page: Page): Promise<void> => {
  const wav = await readFile(new URL("../../../data/whisper/self-check.wav", import.meta.url));
  await page.addInitScript(
    (bytes: number[]) => {
      const getUserMedia = async (): Promise<MediaStream> => {
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
        const source = context.createBufferSource();
        const output = context.createMediaStreamDestination();
        source.buffer = buffer;
        source.connect(output);
        source.start(context.currentTime + 0.3);
        return output.stream;
      };
      Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
        configurable: true,
        value: getUserMedia,
      });
    },
    [...wav],
  );
};

/** Paths under /models/ the page or its worker asked for. */
const modelRequests = (page: Page): string[] => {
  const paths: string[] = [];
  page.context().on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/models/")) paths.push(pathname);
  });
  return paths;
};

const speechCaches = (page: Page): Promise<string[]> =>
  page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.startsWith("speech-model-")),
  );

test.beforeEach(({ browserName }) => {
  test.skip(
    process.platform === "win32" && browserName === "webkit",
    "WebKit for Windows has no Web Audio; CI runs this on Linux",
  );
});

const downloadButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: /^Download speech recognition \(/u });

/** One model download for the whole flow: each test downloads it again (about 170 MB with WebGPU). */
test("offers speech recognition, downloads it on request, checks a sentence and a word, works offline, deletes it", async ({
  page,
  server,
}) => {
  await fakeMicrophone(page);
  const requested = modelRequests(page);
  const main = page.getByRole("main");
  await page.goto("/learn");
  const audio = main.getByRole("button", { name: /^Download the audio \(/u }).first();
  await expect(audio).toBeVisible({ timeout: 90_000 });
  await audio.click();
  await expect(main.getByText(en.audio.installed).first()).toBeVisible();

  // Word page before the download: an offer, linked to where the model is downloaded.
  await page.goto(`/learn/dictionary/${encodeURIComponent("上学")}`);
  await expect(main.getByText(en.hear.offer)).toBeVisible();
  await main.getByRole("link", { name: en.hear.offerLink }).click();
  await expect(page).toHaveURL(/\/read$/u);
  await expect(downloadButton(page)).toBeVisible();
  // Nothing of the model is fetched before the learner asks: only its index, for the size.
  expect(requested.filter((path) => path !== "/models/index.json")).toEqual([]);
  expect(await accessibilityViolations(page)).toEqual([]);

  // Cross-origin isolated: ONNX Runtime runs WebAssembly on several threads.
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await downloadButton(page).click();
  await expect(main.getByText(/^Speech recognition downloaded \(/u)).toBeVisible({
    timeout: 120_000,
  });
  await main.getByLabel(en.readAloud.sentence).fill(SENTENCE);
  await main.getByRole("button", { name: en.speak.record }).click();
  const status = main.getByRole("status");
  await expect(status).toContainText(en.hear.allRight, { timeout: 90_000 });
  await expect(status).toContainText(`${en.hear.heard} ${SENTENCE}`);
  expect(await accessibilityViolations(page)).toEqual([]);

  // The fake microphone says the sentence, not 上学: the hint lists what differs.
  await page.goto(`/learn/dictionary/${encodeURIComponent("上学")}`);
  await main.getByRole("button", { name: en.speak.record }).click();
  await expect(main.getByText(en.hear.indicative)).toBeVisible({ timeout: 90_000 });
  await expect(main.getByText(`${en.hear.heard} ${SENTENCE}`)).toBeVisible();
  await expect(main.getByText(/^0 of 2 characters heard as expected\.$/u)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await expect
    .poll(
      () =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null,
        ),
      { message: "service worker activated", timeout: 30_000 },
    )
    .toBe("activated");
  await server.goOffline();
  await page.goto("/read");
  await expect(main.getByText(/^Speech recognition downloaded \(/u)).toBeVisible({
    timeout: 30_000,
  });
  await main.getByLabel(en.readAloud.sentence).fill(SENTENCE);
  await main.getByRole("button", { name: en.speak.record }).click();
  await expect(main.getByRole("status")).toContainText(en.hear.allRight, { timeout: 90_000 });

  // Deleted while offline: nothing is left to load and nothing can be downloaded, which the page says.
  await main.getByRole("button", { name: en.speech.delete }).click();
  await expect(main.getByRole("alert")).toContainText(
    "Speech recognition cannot be downloaded here",
  );
  await expect(main.getByLabel(en.readAloud.sentence)).toHaveCount(0);
  expect(await speechCaches(page)).toEqual([]);
});

test("deletes speech recognition and offers it again", async ({ page }) => {
  await page.goto("/read");
  await expect(downloadButton(page)).toBeVisible({ timeout: 90_000 });
  await downloadButton(page).click();
  await page
    .getByRole("main")
    .getByRole("button", { name: en.speech.delete })
    .click({ timeout: 120_000 });
  await expect(downloadButton(page)).toBeVisible();
  expect(await speechCaches(page)).toEqual([]);
});

test("shows a failed download, and the button retries", async ({ page }) => {
  await page.route("**/models/*/onnx/**", (route) => route.abort());
  await page.goto("/read");
  const main = page.getByRole("main");
  await expect(downloadButton(page)).toBeVisible({ timeout: 90_000 });
  await downloadButton(page).click();
  await expect(main.getByRole("alert")).toContainText("could not be downloaded");
  await expect(
    main.getByRole("button", { name: /^Try the speech recognition download again \(/u }),
  ).toBeVisible();
});
