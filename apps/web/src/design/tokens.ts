import { err, ok, type Result } from "@openlinguo/core";
import { parseHex, type Rgb } from "./color.ts";

export type ThemedColor = { readonly light: Rgb; readonly dark: Rgb };

const TOKEN = /--color-([a-z0-9-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\);/giu;

/** `--color-<name>: light-dark(<light>, <dark>)` declarations of a stylesheet, by name. */
export const colorTokens = (css: string): Result<ReadonlyMap<string, ThemedColor>, string> => {
  const tokens = new Map<string, ThemedColor>();
  for (const [, name = "", light = "", dark = ""] of css.matchAll(TOKEN)) {
    const lightRgb = parseHex(light);
    const darkRgb = parseHex(dark);
    if (!lightRgb.ok) return lightRgb;
    if (!darkRgb.ok) return darkRgb;
    if (tokens.has(name)) return err(`duplicate color token ${name}`);
    tokens.set(name, { light: lightRgb.value, dark: darkRgb.value });
  }
  return ok(tokens);
};
