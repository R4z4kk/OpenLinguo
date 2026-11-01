import { describe, expect, it } from "vitest";
import { lettermintMailer } from "./lettermint-mailer.ts";

const config = { token: "lm_test_token", from: "no-reply@example.test" };
const mail = { to: "learner@example.test", subject: "Code", text: "Line <1>\n\nLine & 2" };

const recording = (response: () => Promise<Response>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, fetcher };
};

describe("lettermintMailer", () => {
  it("posts the mail to Lettermint's send API, text and escaped html, tracking off", async () => {
    const { calls, fetcher } = recording(() =>
      Promise.resolve(Response.json({ message_id: "m1", status: "pending" }, { status: 202 })),
    );
    expect(await lettermintMailer(config, fetcher)(mail)).toEqual({ ok: true, value: null });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] ?? { url: "", init: {} };
    expect(url).toBe("https://api.lettermint.co/v1/send");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-lettermint-token": "lm_test_token",
    });
    expect(JSON.parse(typeof init.body === "string" ? init.body : "")).toEqual({
      from: "OpenLinguo <no-reply@example.test>",
      to: ["learner@example.test"],
      subject: "Code",
      text: "Line <1>\n\nLine & 2",
      html: "<p>Line &lt;1&gt;</p><p>Line &amp; 2</p>",
      settings: { track_opens: false, track_clicks: false },
    });
  });

  it("answers rejected with the status when Lettermint refuses the mail", async () => {
    const { fetcher } = recording(() =>
      Promise.resolve(
        Response.json({ message: "The from domain is not verified." }, { status: 422 }),
      ),
    );
    expect(await lettermintMailer(config, fetcher)(mail)).toEqual({
      ok: false,
      error: { kind: "rejected", message: "Lettermint answered 422" },
    });
  });

  it("answers unreachable when the request fails or times out", async () => {
    const { fetcher } = recording(() =>
      Promise.reject(new DOMException("timeout", "TimeoutError")),
    );
    expect(await lettermintMailer(config, fetcher)(mail)).toEqual({
      ok: false,
      error: { kind: "unreachable", message: "Lettermint unreachable: timeout" },
    });
  });
});
