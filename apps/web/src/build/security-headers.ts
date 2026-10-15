import { err, ok, type Result } from "@openlinguo/core";

/** A rule of a Cloudflare Pages `_headers` file: `! Name` lines go to `unset`. */
export type HeaderRule = {
  readonly pattern: string;
  readonly set: Readonly<Record<string, string>>;
  readonly unset: readonly string[];
};

/** The rules of a `_headers` file, in order. */
export const parseHeaderRules = (text: string): Result<readonly HeaderRule[], string> => {
  const rules: { pattern: string; set: Record<string, string>; unset: string[] }[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/u.test(line)) {
      rules.push({ pattern: line.trim(), set: {}, unset: [] });
      continue;
    }
    const current = rules.at(-1) ?? null;
    const detached = /^\s+!\s+(\S+)\s*$/u.exec(line)?.[1] ?? null;
    if (current !== null && detached !== null) {
      current.unset.push(detached);
      continue;
    }
    const colon = line.indexOf(":");
    if (current === null || colon < 0) {
      return err(`line ${String(index + 1)}: header outside a rule or without a colon`);
    }
    current.set[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return rules.some(({ pattern }) => pattern === "/*") ? ok(rules) : err("no /* rule");
};

const escape = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/gu, "\\$&");
const matches = (pattern: string, path: string): boolean =>
  new RegExp(`^${pattern.split("*").map(escape).join(".*")}$`, "u").test(path);

/**
 * The headers Pages sends for a path, as its asset server applies them (`@cloudflare/pages-shared`
 * 0.13.197, asset-server/handler.ts): every matching rule in order, its `unset` then its `set`; a
 * header set again by a later rule is appended, joined with a comma.
 */
export const headersFor = (
  rules: readonly HeaderRule[],
  path: string,
): Readonly<Record<string, string>> => {
  const headers = new Map<string, string>();
  for (const rule of rules.filter(({ pattern }) => matches(pattern, path))) {
    for (const name of rule.unset) headers.delete(name);
    for (const [name, value] of Object.entries(rule.set)) {
      const previous = headers.get(name) ?? null;
      headers.set(name, previous === null ? value : `${previous}, ${value}`);
    }
  }
  return Object.fromEntries(headers);
};

/** Headers of the `/*` rule. */
export const parseHeaders = (text: string): Result<Readonly<Record<string, string>>, string> => {
  const rules = parseHeaderRules(text);
  return rules.ok ? ok(headersFor(rules.value, "/")) : rules;
};
