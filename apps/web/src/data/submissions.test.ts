import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredText } from "./database.ts";
import {
  listSubmissions,
  loadAccount,
  newSubmission,
  sendSubmission,
  withdrawSubmission,
} from "./submissions.ts";

const provenance = {
  origin: "ai",
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  promptVersion: "zh-story-v1",
  createdAt: "2026-10-30T09:00:00.000Z",
} as const;

const pasted: StoredText = {
  id: "t1",
  title: "我的周末",
  body: "我周末去公园。",
  source: "paste",
  provenance: null,
  createdAt: 0,
  readingChoices: {},
};
const story: StoredText = { ...pasted, source: "ai", provenance };

const submitted = {
  id: "s1",
  title: "我的周末",
  body: "我周末去公园。",
  attribution: null,
  origin: "human",
  provenance: null,
  licence: "CC-BY-SA-4.0",
  status: "pending",
  attestationVersion: 1,
  attestedAt: "2026-10-31T10:00:00.000Z",
  createdAt: "2026-10-31T10:00:00.000Z",
};

const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newSubmission", () => {
  it("sends a pasted or imported text as the learner's own", () => {
    expect(newSubmission(pasted, { kind: "anonymous" })).toEqual({
      origin: "human",
      provenance: null,
      title: "我的周末",
      body: "我周末去公园。",
      attribution: { kind: "anonymous" },
      attestationVersion: 1,
    });
  });

  it("sends a story with its provenance", () => {
    expect(newSubmission(story, { kind: "pseudonym", name: "小明" })).toMatchObject({
      origin: "ai",
      provenance,
      attribution: { kind: "pseudonym", name: "小明" },
    });
  });
});

describe("the API calls", () => {
  it("read a signed-in account, with or without a pseudonym, and a signed-out one", async () => {
    answer(200, { session: {}, user: { name: "小明" } });
    expect(await loadAccount()).toEqual({ ok: true, value: { pseudonym: "小明" } });
    answer(200, { session: {}, user: { name: "" } });
    expect(await loadAccount()).toEqual({ ok: true, value: { pseudonym: null } });
    answer(200, null);
    expect(await loadAccount()).toEqual({ ok: true, value: null });
  });

  it("never read a page that is not JSON as signed out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<!doctype html>", { status: 200 }))),
    );
    expect(await loadAccount()).toEqual({ ok: false, error: { kind: "unexpected", status: 200 } });
  });

  it("post the text as JSON and check the answer", async () => {
    answer(201, submitted);
    const sent = await sendSubmission(newSubmission(pasted, { kind: "anonymous" }));
    expect(sent).toEqual({ ok: true, value: submitted });
    expect(fetch).toHaveBeenCalledWith(
      "/api/submissions",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });

  it("turn a typed refusal into its code", async () => {
    answer(409, { code: "SUBMISSION_LIMIT", message: "At most 5 texts pending review" });
    expect(await sendSubmission(newSubmission(pasted, { kind: "anonymous" }))).toEqual({
      ok: false,
      error: { kind: "refused", code: "SUBMISSION_LIMIT" },
    });
  });

  it("report an answer that breaks the contract and a failed network", async () => {
    answer(200, [{ ...submitted, licence: "CC0-1.0" }]);
    expect(await listSubmissions()).toEqual({
      ok: false,
      error: { kind: "unexpected", status: 200 },
    });
    answer(502, "<html>Bad gateway</html>");
    expect(await listSubmissions()).toEqual({
      ok: false,
      error: { kind: "unexpected", status: 502 },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await listSubmissions()).toEqual({ ok: false, error: { kind: "offline" } });
  });

  it("withdraw by id", async () => {
    answer(204, null);
    expect(await withdrawSubmission("a/b")).toEqual({ ok: true, value: null });
    expect(fetch).toHaveBeenCalledWith(
      "/api/submissions/a%2Fb",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
