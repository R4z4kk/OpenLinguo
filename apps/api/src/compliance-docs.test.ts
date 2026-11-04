import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema.ts";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const tables = Object.values(schema).flatMap((value) =>
  is(value, SQLiteTable) ? [getTableConfig(value).name] : [],
);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
      return [];
    }
    const child = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(child) : [child];
  });

describe("compliance documents", () => {
  it("names every table of the schema in the data map", () => {
    const dataMap = read("docs/compliance/data-map.md");
    expect(tables.length).toBeGreaterThan(10);
    expect(tables.filter((table) => !dataMap.includes(`\`${table}\``))).toEqual([]);
  });

  it("turns no Workers Logs or log push on, as the records of processing say", () => {
    for (const path of ["apps/api/wrangler.jsonc", "apps/web/wrangler.jsonc"]) {
      const config = read(path)
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(config, path).not.toMatch(/"(observability|logpush|tail_consumers)"/u);
    }
  });

  it("names the replaced mail provider nowhere in the code", () => {
    const retired = new RegExp(["scale", "way"].join(""), "iu");
    const directories = [
      "apps/api/",
      "apps/web/src/",
      "apps/web/functions/",
      "packages/",
      ".github/",
    ];
    const found = directories
      .flatMap((directory) => sourceFiles(join(root, directory)))
      .filter((file) => /\.(ts|tsx|jsonc?|sql|ya?ml|md)$/u.test(file))
      .filter((file) => retired.test(readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });
});
