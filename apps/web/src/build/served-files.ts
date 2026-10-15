import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/** Pages serves files up to 25 MiB (developers.cloudflare.com/pages/platform/limits, checked 2026-10-14). */
export const PAGES_FILE_LIMIT = 25 * 1024 * 1024;

/** Files under `dir` above `limit` bytes, paths relative to `dir`. */
export const oversizedFiles = async (
  dir: string,
  limit: number,
): Promise<readonly { readonly path: string; readonly bytes: number }[]> => {
  const found: { path: string; bytes: number }[] = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const { size } = await stat(path);
    if (size > limit) found.push({ path: relative(dir, path).replaceAll("\\", "/"), bytes: size });
  }
  return found;
};
