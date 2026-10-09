import { describe, expect, it } from "vitest";
import headersFile from "../../public/_headers?raw";
import { parseHeaders } from "./security-headers.ts";

const parsed = parseHeaders(headersFile);
if (!parsed.ok) throw new Error(parsed.error);
const headers = parsed.value;

const directives = new Map(
  (headers["Content-Security-Policy"] ?? "").split(";").map((directive) => {
    const [name = "", ...sources] = directive.trim().split(/\s+/u);
    return [name, sources.join(" ")] as const;
  }),
);

describe("public/_headers", () => {
  it("restricts every resource to the project origin, without inline or eval scripts", () => {
    expect(directives.get("default-src")).toBe("'self'");
    expect(directives.get("script-src")).toBe("'self'");
    expect(directives.get("object-src")).toBe("'none'");
    expect(directives.get("frame-ancestors")).toBe("'none'");
  });

  it("enforces HTTPS for at least a year", () => {
    const maxAge = /max-age=(\d+)/u.exec(headers["Strict-Transport-Security"] ?? "")?.[1];
    expect(Number(maxAge)).toBeGreaterThanOrEqual(31_536_000);
  });

  it("allows the microphone for the app only", () => {
    expect(headers["Permissions-Policy"]).toContain("microphone=(self)");
  });

  it("rejects a header outside a rule and a file without the /* rule", () => {
    expect(parseHeaders("  X-Test: 1").ok).toBe(false);
    expect(parseHeaders("/api\n  X-Test: 1")).toEqual({ ok: false, error: "no /* rule" });
  });
});
