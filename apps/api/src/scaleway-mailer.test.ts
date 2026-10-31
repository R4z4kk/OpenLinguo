import { describe, expect, it } from "vitest";
import { scalewayMailer } from "./scaleway-mailer.ts";

const config = {
  secretKey: "scw-test-key",
  projectId: "11111111-1111-4111-8111-111111111111",
  from: "no-reply@example.test",
};
const mail = { to: "learner@example.test", subject: "Code", text: "Line <1>\n\nLine & 2" };

const recording = (response: () => Promise<Response>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, fetcher };
};

describe("scalewayMailer", () => {
  it("posts the mail to Scaleway's fr-par API, text and escaped html, with the key header", async () => {
    const { calls, fetcher } = recording(() =>
      Promise.resolve(Response.json({ emails: [{ id: "e1", status: "new" }] })),
    );
    expect(await scalewayMailer(config, fetcher)(mail)).toEqual({ ok: true, value: null });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] ?? { url: "", init: {} };
    expect(url).toBe("https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Auth-Token": "scw-test-key",
    });
    expect(JSON.parse(typeof init.body === "string" ? init.body : "")).toEqual({
      from: { email: "no-reply@example.test", name: "OpenLinguo" },
      to: [{ email: "learner@example.test" }],
      subject: "Code",
      text: "Line <1>\n\nLine & 2",
      html: "<p>Line &lt;1&gt;</p><p>Line &amp; 2</p>",
      project_id: config.projectId,
    });
  });

  it("answers rejected with the status when Scaleway refuses the mail", async () => {
    const { fetcher } = recording(() =>
      Promise.resolve(Response.json({ message: "domain not checked" }, { status: 403 })),
    );
    expect(await scalewayMailer(config, fetcher)(mail)).toEqual({
      ok: false,
      error: { kind: "rejected", message: "Scaleway answered 403" },
    });
  });

  it("answers unreachable when the request fails or times out", async () => {
    const { fetcher } = recording(() =>
      Promise.reject(new DOMException("timeout", "TimeoutError")),
    );
    expect(await scalewayMailer(config, fetcher)(mail)).toEqual({
      ok: false,
      error: { kind: "unreachable", message: "Scaleway unreachable: timeout" },
    });
  });
});
