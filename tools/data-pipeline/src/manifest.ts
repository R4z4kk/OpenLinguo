import { readFile } from "node:fs/promises";
import { err, parseWith, type Result, type ValidationIssue } from "@openlinguo/core";
import { z } from "zod";

const ManifestEntry = z.strictObject({
  source: z.url(),
  license: z.string().min(1),
  version: z.string().min(1),
  retrievedAt: z.iso.datetime(),
  maxAgeDays: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const Manifest = z.record(z.string(), ManifestEntry);

export type ManifestEntry = z.output<typeof ManifestEntry>;
export type Manifest = z.output<typeof Manifest>;

export type ManifestError =
  | { readonly kind: "manifest-unreadable"; readonly message: string }
  | { readonly kind: "manifest-invalid"; readonly issues: readonly ValidationIssue[] };

export const parseManifest = (json: string): Result<Manifest, ManifestError> => {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch (error) {
    return err({ kind: "manifest-unreadable", message: String(error) });
  }
  const parsed = parseWith(Manifest, input);
  return parsed.ok ? parsed : err({ kind: "manifest-invalid", issues: parsed.error.issues });
};

export const readManifest = async (path: URL): Promise<Result<Manifest, ManifestError>> => {
  try {
    return parseManifest(await readFile(path, "utf8"));
  } catch (error) {
    return err({ kind: "manifest-unreadable", message: String(error) });
  }
};

export const serializeManifest = (manifest: Manifest): string => {
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
};
