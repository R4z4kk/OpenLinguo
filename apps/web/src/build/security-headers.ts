import { err, ok, type Result } from "@openlinguo/core";

/** Headers of the `/*` rule of a Cloudflare Pages `_headers` file. */
export const parseHeaders = (text: string): Result<Readonly<Record<string, string>>, string> => {
  const rules = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/u.test(line)) {
      current = {};
      rules.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(":");
    if (current === null || colon < 0) {
      return err(`line ${String(index + 1)}: header outside a rule or without a colon`);
    }
    current[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const all = rules.get("/*");
  return all ? ok(all) : err("no /* rule");
};
