import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oversizedFiles } from "./served-files.ts";

describe("oversizedFiles", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "served-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists the files above the limit, in subdirectories too", async () => {
    await mkdir(join(dir, "models", "onnx"), { recursive: true });
    await writeFile(join(dir, "index.html"), "x".repeat(10));
    await writeFile(join(dir, "models", "onnx", "decoder.onnx"), "x".repeat(11));
    expect(await oversizedFiles(dir, 10)).toEqual([
      { path: "models/onnx/decoder.onnx", bytes: 11 },
    ]);
  });
});
