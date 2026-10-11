import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { openSqlite, type SqlRow } from "./sqlite.ts";

const directory = mkdtempSync(join(tmpdir(), "sqlite-test-"));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

let files = 0;

/** A database file written by SQLite itself. */
const build = (
  statements: string,
  rows: ((db: DatabaseSync) => void) | null = null,
): Uint8Array => {
  files += 1;
  const path = join(directory, `${String(files)}.sqlite`);
  const db = new DatabaseSync(path);
  db.exec(statements);
  db.exec("BEGIN");
  rows?.(db);
  db.exec("COMMIT");
  db.close();
  return new Uint8Array(readFileSync(path));
};

const rowsOf = (bytes: Uint8Array, table: string): readonly SqlRow[] => {
  const file = openSqlite(bytes);
  if (!file.ok) throw new Error(file.error.kind);
  const rows = file.value.rows(table);
  if (!rows.ok) throw new Error(rows.error.kind);
  return rows.value;
};

const text = (index: number, length: number): string => `${String(index)}:${"字".repeat(length)}`;

const VALUES = [
  null,
  0,
  1,
  -1,
  127,
  -32_768,
  8_388_607,
  -2_147_483_648,
  140_737_488_355_327,
  2n ** 62n,
  -(2n ** 63n),
  1.5,
  "",
  "你好",
  new Uint8Array([0, 255, 7]),
] as const;

describe("openSqlite", () => {
  it.each([512, 4096, 65_536])(
    "reads every row of a multi-level table with overflow pages (page size %i)",
    (pageSize) => {
      const count = 1500;
      const bytes = build(
        `PRAGMA page_size = ${String(pageSize)}; CREATE TABLE notes (id integer PRIMARY KEY, body text, data blob);`,
        (db) => {
          const insert = db.prepare("INSERT INTO notes VALUES (?, ?, ?)");
          for (let index = 1; index <= count; index++)
            insert.run(index * 7, text(index, index % 50 === 0 ? 30_000 : index % 20), null);
        },
      );
      const rows = rowsOf(bytes, "notes");
      expect(rows).toHaveLength(count);
      expect(rows[0]).toEqual({ rowid: 7, values: [null, text(1, 1), null] });
      rows.forEach((row, index) => {
        expect(row).toEqual({
          rowid: (index + 1) * 7,
          values: [null, text(index + 1, (index + 1) % 50 === 0 ? 30_000 : (index + 1) % 20), null],
        });
      });
    },
  );

  it("reads every value type, with integers beyond the safe range as bigint", () => {
    const bytes = build("CREATE TABLE value (id integer PRIMARY KEY, value);", (db) => {
      const insert = db.prepare("INSERT INTO value (value) VALUES (?)");
      for (const value of VALUES) insert.run(value);
    });
    expect(rowsOf(bytes, "value").map((row) => row.values[1])).toEqual(VALUES);
  });

  it("reads a WITHOUT ROWID table spread over interior and leaf pages", () => {
    const count = 3000;
    const bytes = build(
      "PRAGMA page_size = 512; CREATE TABLE fields (ntid integer, ord integer, name text, PRIMARY KEY (ntid, ord)) WITHOUT ROWID;",
      (db) => {
        const insert = db.prepare("INSERT INTO fields VALUES (?, ?, ?)");
        for (let index = count; index > 0; index--)
          insert.run(Math.floor(index / 10), index % 10, text(index, index % 100 === 0 ? 500 : 3));
      },
    );
    const rows = rowsOf(bytes, "fields");
    expect(rows).toHaveLength(count);
    const expected = Array.from({ length: count }, (_, offset) => offset + 1)
      .map((index) => [
        Math.floor(index / 10),
        index % 10,
        text(index, index % 100 === 0 ? 500 : 3),
      ])
      .sort(([a = 0, b = 0], [c = 0, d = 0]) => Number(a) - Number(c) || Number(b) - Number(d));
    expect(rows.map((row) => row.values)).toEqual(expected);
    expect(rows.every((row) => row.rowid === null)).toBe(true);
  });

  it("lists the tables and fails on a missing one", () => {
    const file = openSqlite(
      build("CREATE TABLE a (x); CREATE TABLE b (y); CREATE INDEX i ON a (x);"),
    );
    expect(file.ok && [...file.value.tables].sort()).toEqual(["a", "b"]);
    expect(file.ok && file.value.rows("c")).toEqual({
      ok: false,
      error: { kind: "missing-table", table: "c" },
    });
  });

  it("rejects a file that is not a database", () => {
    expect(openSqlite(new TextEncoder().encode("hello".repeat(40)))).toEqual({
      ok: false,
      error: { kind: "not-sqlite" },
    });
  });

  it("rejects a database whose text is not UTF-8", () => {
    const result = openSqlite(build("PRAGMA encoding = 'UTF-16le'; CREATE TABLE a (x);"));
    expect(result).toEqual({
      ok: false,
      error: { kind: "corrupt-database", detail: "text is not UTF-8" },
    });
  });

  it("fails without looping on a corrupt b-tree", () => {
    const bytes = build("PRAGMA page_size = 512; CREATE TABLE a (x);", (db) => {
      const insert = db.prepare("INSERT INTO a VALUES (?)");
      for (let index = 0; index < 200; index++) insert.run(text(index, 10));
    });
    const view = new DataView(bytes.buffer);
    // Page 2 is the root of `a`, an interior page: its right-most child now points back to it.
    expect(bytes[512]).toBe(0x05);
    view.setUint32(512 + 8, 2);
    const file = openSqlite(bytes);
    expect(file.ok && file.value.rows("a")).toEqual({
      ok: false,
      error: { kind: "corrupt-database", detail: "b-tree loop" },
    });
    bytes[512] = 0x42;
    const broken = openSqlite(bytes);
    expect(broken.ok && broken.value.rows("a")).toEqual({
      ok: false,
      error: { kind: "corrupt-database", detail: "page 2 is not a b-tree page" },
    });
  });
});
