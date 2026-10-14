import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { manifestPath, readManifest } from "../manifest.ts";
import { AUDIO_DATASET, packIndexPath, packIndexSchema } from "./pack-index.ts";

describe.skipIf(!existsSync(packIndexPath))("audio packs", () => {
  it("are pinned in data/manifest.json", async () => {
    const manifest = await readManifest(manifestPath);
    const bytes = await readFile(packIndexPath);
    expect(manifest.ok && manifest.value[AUDIO_DATASET]?.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("were built from the current word lists (rebuild them with tts-packs after a refresh)", async () => {
    const manifest = await readManifest(manifestPath);
    const index = packIndexSchema.parse(JSON.parse(await readFile(packIndexPath, "utf8")));
    for (const [dataset, sha256] of Object.entries(index.words)) {
      expect(manifest.ok && manifest.value[dataset]?.sha256, dataset).toBe(sha256);
    }
  });
});
