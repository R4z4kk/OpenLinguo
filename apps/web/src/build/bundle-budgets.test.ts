import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SizeBudget } from "./budgets.ts";
import {
  describeOverrun,
  measureBuild,
  overruns,
  precachedUrls,
  type Measures,
} from "./bundle-budgets.ts";

const budget = (id: SizeBudget["id"], limit: number): SizeBudget => ({
  id,
  label: `the ${id}`,
  measured: 0,
  limit,
  fix: "Do this.",
});

const SERVICE_WORKER =
  'precacheAndRoute([{url:"index.html",revision:"a"},{url:"assets/app.js",revision:null},{url:"index.html",revision:"a"}])';

describe("precachedUrls", () => {
  it("lists each precached file once", () => {
    expect(precachedUrls(SERVICE_WORKER)).toEqual(["index.html", "assets/app.js"]);
  });

  it("finds nothing in a service worker without a manifest", () => {
    expect(precachedUrls("self.skipWaiting()")).toEqual([]);
  });
});

describe("overruns", () => {
  const measures: Measures = { js: 101, css: 100, precache: 1, import: 1 };

  it("reports a measure above its limit, not one at the limit", () => {
    const found = overruns(measures, [
      budget("js", 100),
      budget("css", 100),
      budget("precache", 5),
    ]);
    expect(found.map(({ budget: { id }, measure }) => [id, measure])).toEqual([["js", 101]]);
  });

  it("says what to do, and where to raise the limit", () => {
    const [found] = overruns(measures, [budget("js", 100)]);
    expect(found).toBeDefined();
    const message = describeOverrun(found as NonNullable<typeof found>);
    expect(message).toContain("the js: 0 kB, over the 0 kB budget. Do this.");
    expect(message).toContain("src/build/budgets.ts");
  });
});

describe("measureBuild", () => {
  let dist = "";
  beforeEach(async () => {
    dist = await mkdtemp(join(tmpdir(), "budgets-"));
    await mkdir(join(dist, "assets"));
    await mkdir(join(dist, "data"));
  });
  afterEach(async () => {
    await rm(dist, { recursive: true, force: true });
  });

  const write = (path: string, content: string) => writeFile(join(dist, path), content);

  it("counts what the budgets name", async () => {
    await write("sw.js", SERVICE_WORKER);
    await write("index.html", "x".repeat(10));
    await write("assets/app.js", "x".repeat(20));
    await write("assets/style.css", "y".repeat(5));
    await write("assets/font.woff2", "z".repeat(1000));
    await write("data/a.json", "[]");
    await write("data/unlisted.json", "[]".repeat(100));
    await write(
      "data/index.json",
      JSON.stringify({
        version: "v1",
        files: [{ name: "a.json", kind: "entries", sha256: "0".repeat(64), rows: 0 }],
      }),
    );
    const measures = await measureBuild(dist);
    expect(measures).toMatchObject({ ok: true, value: { precache: 30, import: 2 } });
    if (measures.ok) {
      expect(measures.value.js).toBeGreaterThan(0);
      expect(measures.value.js).toBeLessThan(40);
      expect(measures.value.css).toBeGreaterThan(0);
    }
  });

  it("fails when the service worker lists nothing", async () => {
    await write("sw.js", "self.skipWaiting()");
    expect(await measureBuild(dist)).toMatchObject({ ok: false });
  });

  it("fails when there is no build", async () => {
    const missing = await measureBuild(join(dist, "missing"));
    expect(missing).toMatchObject({ ok: false });
    if (!missing.ok) expect(missing.error).toContain("pnpm build");
  });
});
