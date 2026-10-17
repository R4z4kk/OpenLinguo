import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { err, ok, parseWith, type Result } from "@openlinguo/core";
import { z } from "zod";

/** The licenses of the code shipped in the app, served at the root of the site. */
export const NOTICES_FILE = "THIRD-PARTY-NOTICES.txt";

const NODE_MODULES = "/node_modules/";
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/iu;
const README_FILE = /^readme(?:\.md)?$/iu;
const LEGAL_COMMENT = /^\s*(\/\*![\s\S]*?\*\/)/u;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/u;
const WORKBOX_MARKER = /workbox:([a-z-]+):\d+\.\d+\.\d+/gu;

const PackageJson = z.object({ name: z.string(), version: z.string(), license: z.string() });

export type PackageNotice = {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  /** The package's license and notice files, in file name order. */
  readonly texts: readonly string[];
};

/** Code ported into the repository, with the notice its license asks to keep. */
export type PortedNotice = { readonly path: string; readonly comment: string };

const pathOf = (moduleId: string): string => (moduleId.split("?")[0] ?? "").replaceAll("\\", "/");

/** The directory of the npm package a bundled module comes from; null for the app's own code. */
export const packageDirOf = (moduleId: string): string | null => {
  const path = pathOf(moduleId);
  const at = path.lastIndexOf(NODE_MODULES);
  if (at === -1) return null;
  const segments = path.slice(at + NODE_MODULES.length).split("/");
  const depth = segments[0]?.startsWith("@") === true ? 2 : 1;
  if (segments.length <= depth) return null;
  return path.slice(0, at + NODE_MODULES.length) + segments.slice(0, depth).join("/");
};

/** The text under a README's "License" heading, down to the next heading of its level or above. */
export const readmeLicenseOf = (readme: string): string | null => {
  const lines = readme.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^#{1,6}\s+licen[cs]e\b/iu.test(line));
  if (start === -1) return null;
  const level = /^#+/u.exec(lines[start] ?? "")?.[0].length ?? 0;
  const end = lines.findIndex((line, index) => {
    const heading = /^#+(?=\s)/u.exec(line)?.[0].length ?? null;
    return index > start && heading !== null && heading <= level;
  });
  const text = lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .join("\n")
    .trim();
  return text === "" ? null : text;
};

/** A source's leading `/*!` comment, which marks the license notice of ported code. */
export const legalCommentOf = (source: string): string | null =>
  LEGAL_COMMENT.exec(source)?.[1] ?? null;

/**
 * The Workbox packages a generated runtime is built from: each module marks itself in the code
 * (`workbox:core:7.4.0`). The version in a marker can lag the package's, so only names are kept.
 */
export const workboxPackagesOf = (runtime: string): readonly string[] => [
  ...new Set(Array.from(runtime.matchAll(WORKBOX_MARKER), ([, name = ""]) => `workbox-${name}`)),
];

/** The directories of `packages` as vite-plugin-pwa's workbox-build resolves them from `app`. */
export const resolveWorkboxDirs = (
  packages: readonly string[],
  app: string,
): Result<readonly string[], string> => {
  const web = createRequire(join(app, "package.json"));
  const pwa = createRequire(web.resolve("vite-plugin-pwa/package.json"));
  const build = createRequire(pwa.resolve("workbox-build/package.json"));
  const dirs: string[] = [];
  for (const name of packages) {
    try {
      dirs.push(dirname(build.resolve(`${name}/package.json`)));
    } catch {
      return err(`${name}, in the Workbox runtime, does not resolve from workbox-build`);
    }
  }
  return ok(dirs);
};

const readPackageNotice = async (dir: string): Promise<Result<PackageNotice, string>> => {
  const manifest = parseWith(
    PackageJson,
    JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as unknown,
  );
  if (!manifest.ok) {
    return err(`${dir}/package.json: ${manifest.error.issues.map((i) => i.message).join(", ")}`);
  }
  const { name, version, license } = manifest.value;
  const entries = await readdir(dir);
  const files = entries.filter((entry) => LICENSE_FILE.test(entry)).toSorted();
  if (files.length > 0) {
    const texts = await Promise.all(files.map((file) => readFile(join(dir, file), "utf8")));
    return ok({ name, version, license, texts: texts.map((text) => text.trim()) });
  }
  const readme = entries.find((entry) => README_FILE.test(entry)) ?? null;
  if (readme === null) return err(`${name}@${version} has no license file and no README`);
  const section = readmeLicenseOf(await readFile(join(dir, readme), "utf8"));
  if (section === null)
    return err(`${name}@${version} has no license file or README license section`);
  return ok({ name, version, license, texts: [`(From ${readme}.)\n\n${section}`] });
};

/** The notices of the code `moduleIds` were bundled from, and of the packages in `packageDirs`. */
export const collectNotices = async ({
  moduleIds,
  packageDirs,
  root,
}: {
  readonly moduleIds: Iterable<string>;
  readonly packageDirs: readonly string[];
  /** Paths of ported code are given from there. */
  readonly root: string;
}): Promise<Result<{ packages: PackageNotice[]; ported: PortedNotice[] }, string>> => {
  const dirs = new Set(packageDirs);
  const sources = new Set<string>();
  for (const id of moduleIds) {
    if (id.startsWith("\0")) continue;
    const dir = packageDirOf(id);
    if (dir !== null) dirs.add(dir);
    else if (SOURCE_FILE.test(pathOf(id))) sources.add(pathOf(id));
  }
  const packages = new Map<string, PackageNotice>();
  const failures: string[] = [];
  for (const dir of dirs) {
    const notice = await readPackageNotice(dir);
    if (notice.ok) packages.set(`${notice.value.name}@${notice.value.version}`, notice.value);
    else failures.push(notice.error);
  }
  if (failures.length > 0) return err(failures.toSorted().join("; "));
  const ported: PortedNotice[] = [];
  for (const path of sources) {
    const comment = legalCommentOf(await readFile(path, "utf8"));
    if (comment !== null)
      ported.push({ path: relative(root, path).replaceAll("\\", "/"), comment });
  }
  return ok({
    packages: [...packages.values()].toSorted(
      (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
    ),
    ported: ported.toSorted((a, b) => a.path.localeCompare(b.path, "en")),
  });
};

const RULE = "=".repeat(80);

/** The notices file: ported code first, then every package with its license texts. */
export const formatNotices = (
  packages: readonly PackageNotice[],
  ported: readonly PortedNotice[],
): string =>
  [
    "OpenLinguo is free software under the AGPL-3.0 (https://github.com/R4z4kk/OpenLinguo).",
    "This file lists the third-party code shipped in the app, with the notices its licenses ask",
    "to keep. Data, fonts and speech models are credited on the About page, with their license",
    "texts under /data/licenses/; the speech recognizer's WebAssembly build (sherpa-onnx, ONNX",
    "Runtime, Emscripten) lists its own in /data/licenses/paraformer/THIRD-PARTY-LICENSES.txt.",
    "",
    ...ported.flatMap(({ path, comment }) => [RULE, `Ported code: ${path}`, RULE, comment, ""]),
    ...packages.flatMap(({ name, version, license, texts }) => [
      RULE,
      `${name} ${version} (${license})`,
      RULE,
      texts.join(`\n\n${"-".repeat(80)}\n\n`),
      "",
    ]),
  ].join("\n");
