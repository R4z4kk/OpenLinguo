import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectNotices,
  formatNotices,
  legalCommentOf,
  packageDirOf,
  readmeLicenseOf,
  workboxPackagesOf,
} from "./third-party-notices.ts";

describe("packageDirOf", () => {
  it("takes the innermost package, scoped or not, without the query", () => {
    expect(packageDirOf("/r/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/api.js")).toBe(
      "/r/node_modules/.pnpm/zod@4.6.5/node_modules/zod",
    );
    expect(packageDirOf("/r/node_modules/@tanstack/store/dist/index.js?commonjs-es-import")).toBe(
      "/r/node_modules/@tanstack/store",
    );
  });

  it("is null for the app's own code", () => {
    expect(packageDirOf("/r/apps/web/src/main.tsx")).toBeNull();
    expect(packageDirOf("/r/packages/core/src/fsrs.ts")).toBeNull();
  });
});

describe("readmeLicenseOf", () => {
  it("keeps the section down to the next heading of its level or above", () => {
    const readme = "# fft\n\n## Usage\n\nx\n\n#### LICENSE\n\nMIT, Copyright A.\n\n### Next\n\ny\n";
    expect(readmeLicenseOf(readme)).toBe("MIT, Copyright A.");
  });

  it("runs to the end without a later heading, and is null without a section", () => {
    expect(readmeLicenseOf("# x\n\n## License\n\nISC\n")).toBe("ISC");
    expect(readmeLicenseOf("# x\n\nNo heading for it.\n")).toBeNull();
    expect(readmeLicenseOf("# x\n\n## License\n\n## Other\n")).toBeNull();
  });
});

describe("legalCommentOf", () => {
  it("takes a leading /*! comment only", () => {
    expect(legalCommentOf("\n/*!\n * MIT, Copyright A.\n */\nexport const a = 1;\n")).toBe(
      "/*!\n * MIT, Copyright A.\n */",
    );
    expect(legalCommentOf("/** Docs. */\nexport const a = 1;\n")).toBeNull();
    expect(legalCommentOf("export const a = 1;\n/*! late */\n")).toBeNull();
  });
});

describe("workboxPackagesOf", () => {
  it("names each package marked in the runtime, once", () => {
    const runtime = `self["workbox:core:7.4.0"]&&_();self["workbox:routing:7.4.0"];self["workbox:core:7.4.0"]`;
    expect(workboxPackagesOf(runtime)).toEqual(["workbox-core", "workbox-routing"]);
  });
});

describe("collectNotices", () => {
  let root = "";
  const pkg = async (name: string, files: Readonly<Record<string, string>>, license = "MIT") => {
    const dir = join(root, "node_modules", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license }));
    for (const [file, text] of Object.entries(files)) await writeFile(join(dir, file), text);
    return dir;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "notices-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads license and notice files, the README section without them, and ported code", async () => {
    const apache = await pkg("apache", { LICENSE: "Apache\n", NOTICE: "Notice\n" }, "Apache-2.0");
    await pkg("readme-only", { "README.md": "# r\n\n## License\n\nMIT, Copyright R.\n" });
    const extra = await pkg("@scope/extra", { "LICENSE.md": "ISC\n" }, "ISC");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "ported.ts"), "/*! MIT, Copyright P. */\nexport {};\n");
    await writeFile(join(root, "src", "own.ts"), "export {};\n");

    const notices = await collectNotices({
      moduleIds: [
        join(apache, "index.js"),
        join(apache, "other.js"),
        join(root, "node_modules", "readme-only", "index.js"),
        join(root, "src", "ported.ts"),
        join(root, "src", "own.ts"),
        "\0rolldown/runtime.js",
      ],
      packageDirs: [extra],
      root,
    });

    expect(notices).toEqual({
      ok: true,
      value: {
        packages: [
          { name: "@scope/extra", version: "1.0.0", license: "ISC", texts: ["ISC"] },
          { name: "apache", version: "1.0.0", license: "Apache-2.0", texts: ["Apache", "Notice"] },
          {
            name: "readme-only",
            version: "1.0.0",
            license: "MIT",
            texts: ["(From README.md.)\n\nMIT, Copyright R."],
          },
        ],
        ported: [{ path: "src/ported.ts", comment: "/*! MIT, Copyright P. */" }],
      },
    });
  });

  it("fails on every package with no license text, naming each", async () => {
    await pkg("bare", {});
    await pkg("vague", { "README.md": "# v\n\nMIT.\n" });
    const notices = await collectNotices({
      moduleIds: ["bare", "vague"].map((name) => join(root, "node_modules", name, "index.js")),
      packageDirs: [],
      root,
    });
    expect(notices).toEqual({
      ok: false,
      error:
        "bare@1.0.0 has no license file and no README; vague@1.0.0 has no license file or README license section",
    });
  });
});

describe("formatNotices", () => {
  it("lists ported code, then each package with its license texts", () => {
    const text = formatNotices(
      [{ name: "a", version: "1.0.0", license: "MIT", texts: ["License A", "Notice A"] }],
      [{ path: "src/p.ts", comment: "/*! P */" }],
    );
    expect(text.indexOf("Ported code: src/p.ts")).toBeLessThan(text.indexOf("a 1.0.0 (MIT)"));
    expect(text).toContain("/*! P */");
    expect(text).toContain(`License A\n\n${"-".repeat(80)}\n\nNotice A`);
  });
});
