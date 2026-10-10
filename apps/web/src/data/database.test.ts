import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.ts";

describe("openDatabase", () => {
  it("imports the data again when upgrading a database without search keys", async () => {
    const legacy = new Dexie("upgrade-test");
    legacy.version(1).stores({
      entries: "id, simplified, *variants",
      characters: "character",
      meta: "key",
      imports: "sha256",
    });
    await legacy.table("meta").bulkPut([
      { key: "dataVersion", value: "v1" },
      { key: "importingVersion", value: "v1" },
      { key: "lexicon", value: ["电话"] },
    ]);
    legacy.close();

    const db = openDatabase("upgrade-test");
    expect(await db.meta.toArray()).toEqual([{ key: "lexicon", value: ["电话"] }]);
    db.close();
  });
});
