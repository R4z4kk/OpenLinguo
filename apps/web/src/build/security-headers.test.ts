import { AI_BASE_URLS } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import headersFile from "../../public/_headers?raw";
import { headersFor, parseHeaderRules, parseHeaders } from "./security-headers.ts";

const parsed = parseHeaders(headersFile);
if (!parsed.ok) throw new Error(parsed.error);
const headers = parsed.value;
const rules = parseHeaderRules(headersFile);
if (!rules.ok) throw new Error(rules.error);

const directivesOf = (policy: string | null): ReadonlyMap<string, string> =>
  new Map(
    (policy ?? "").split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/u);
      return [name, sources.join(" ")] as const;
    }),
  );
const directives = directivesOf(headers["Content-Security-Policy"] ?? null);

describe("public/_headers", () => {
  it("restricts every resource to the project origin, without inline or eval scripts", () => {
    expect(directives.get("default-src")).toBe("'self'");
    expect(directives.get("script-src")).toBe("'self'");
    expect(directives.get("object-src")).toBe("'none'");
    expect(directives.get("frame-ancestors")).toBe("'none'");
  });

  it("connects to the AI presets and local servers only (ADR 0012)", () => {
    const connect = directives.get("connect-src") ?? "";
    expect(connect).toBe(
      "'self' https://api.groq.com https://openrouter.ai https://api.mistral.ai http://localhost:* http://127.0.0.1:*",
    );
    for (const provider of ["groq", "openrouter", "mistral"] as const) {
      expect(connect.split(" ")).toContain(new URL(AI_BASE_URLS[provider]).origin);
    }
  });

  it("plays stored audio from Blob URLs, nothing else from outside", () => {
    expect(directives.get("media-src")).toBe("'self' blob:");
  });

  it("enforces HTTPS for at least a year", () => {
    const maxAge = /max-age=(\d+)/u.exec(headers["Strict-Transport-Security"] ?? "")?.[1];
    expect(Number(maxAge)).toBeGreaterThanOrEqual(31_536_000);
  });

  it("allows the microphone for the app only", () => {
    expect(headers["Permissions-Policy"]).toContain("microphone=(self)");
  });

  it("lets the speech worker alone compile WebAssembly, with one policy", () => {
    const worker = headersFor(rules.value, "/assets/speech-worker-AbC123.js");
    expect(directivesOf(worker["Content-Security-Policy"] ?? null).get("script-src")).toBe(
      "'self' 'wasm-unsafe-eval'",
    );
    expect(worker["Content-Security-Policy"]).not.toContain(",");
    expect(worker["Content-Security-Policy"]).not.toContain("connect-src");
    expect(worker["Strict-Transport-Security"]).toBe(headers["Strict-Transport-Security"]);
    const other = headersFor(rules.value, "/assets/index-AbC123.js");
    expect(other["Content-Security-Policy"]).toBe(headers["Content-Security-Policy"]);
  });

  it("applies matching rules in order: unset, then set, a repeated header joined", () => {
    const sample = parseHeaderRules(
      ["/*", "  A: 1", "  B: 2", "/x/*", "  ! A", "  A: 3", "  B: 4"].join("\n"),
    );
    if (!sample.ok) throw new Error(sample.error);
    expect(headersFor(sample.value, "/x/y")).toEqual({ A: "3", B: "2, 4" });
    expect(headersFor(sample.value, "/y")).toEqual({ A: "1", B: "2" });
  });

  it("rejects a header outside a rule and a file without the /* rule", () => {
    expect(parseHeaders("  X-Test: 1").ok).toBe(false);
    expect(parseHeaders("/api\n  X-Test: 1")).toEqual({ ok: false, error: "no /* rule" });
  });
});
