import { Submission, Submissions } from "@openlinguo/core/submission";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { database, hostingRecord, submission, user } from "./schema.ts";
import { memoryMailer } from "./testing/memory-mailer.ts";
import { migratedPlatform } from "./testing/platform.ts";

const ORIGIN = "https://openlinguo.example.test";
const platform = await migratedPlatform();
const db = database(platform.env.DB);
const env = {
  ...platform.env,
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: ORIGIN,
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GITHUB_CLIENT_ID: "github-id",
  GITHUB_CLIENT_SECRET: "github-secret",
  SCW_SECRET_KEY: "scw-key",
  SCW_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
  MAIL_FROM: "no-reply@example.test",
  SIGNUPS_OPEN: "true",
};
afterAll(() => platform.dispose());

let mailer = memoryMailer();
let app = createApp([], () => mailer.sendMail);
let ip = 0;
beforeEach(async () => {
  for (const table of [hostingRecord, submission, user]) await db.delete(table);
  mailer = memoryMailer();
  app = createApp([], () => mailer.sendMail);
  ip += 1;
});

const call = (
  path: string,
  method = "GET",
  body: object | null = null,
  cookie: string | null = null,
) =>
  Promise.resolve(
    app.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "cf-connecting-ip": `198.51.100.${String(ip)}`,
          ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    ),
  );

const signedIn = async (email: string): Promise<string> => {
  await call("/api/auth/email-otp/send-verification-otp", "POST", { email, type: "sign-in" });
  const otp = /\b(\d{6})\b/.exec(mailer.sent.at(-1)?.text ?? "")?.[1];
  if (!otp) throw new Error("no code mailed");
  const response = await call("/api/auth/sign-in/email-otp", "POST", { email, otp });
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  const age = await call("/api/account/age", "POST", { answer: "15-or-over" }, cookie);
  expect(age.status).toBe(204);
  return cookie;
};

const provenance = {
  origin: "ai",
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  promptVersion: "zh-story-v1",
  createdAt: "2026-10-30T09:00:00.000Z",
};
const text = {
  origin: "human",
  provenance: null,
  title: "我的周末",
  body: "我周末去公园。",
  attribution: { kind: "anonymous" },
  attestationVersion: 1,
};

const submit = (cookie: string, body: object = text) =>
  call("/api/submissions", "POST", body, cookie);

const records = async () =>
  (await db.select().from(hostingRecord).orderBy(hostingRecord.id)).map(
    ({ submissionId, operation, ipAddress, port, protocol }) => ({
      submissionId,
      operation,
      ipAddress,
      port,
      protocol,
    }),
  );

describe("POST /api/submissions", () => {
  it("refuses a request without a session", async () => {
    const response = await submit("");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps a learner's text as pending under CC BY-SA 4.0 and records its creation", async () => {
    const cookie = await signedIn("learner@example.test");
    const response = await submit(cookie);
    expect(response.status).toBe(201);
    const created = Submission.parse(await response.json());
    expect(created).toMatchObject({
      title: "我的周末",
      origin: "human",
      provenance: null,
      licence: "CC-BY-SA-4.0",
      attribution: null,
      attestationVersion: 1,
      status: "pending",
    });
    expect(Date.now() - Date.parse(created.attestedAt)).toBeLessThan(60_000);
    expect(await records()).toEqual([
      {
        submissionId: created.id,
        operation: "create",
        ipAddress: `198.51.100.${String(ip)}`,
        port: null,
        protocol: null,
      },
    ]);
  });

  it("licenses a story CC0 1.0 and keeps its provenance", async () => {
    const cookie = await signedIn("learner@example.test");
    const response = await submit(cookie, { ...text, origin: "ai", provenance });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ licence: "CC0-1.0", provenance });
    const [row] = await db.select().from(submission);
    expect(row?.provenance).toEqual(provenance);
  });

  it("ignores a licence sent by the client", async () => {
    const cookie = await signedIn("learner@example.test");
    const response = await submit(cookie, { ...text, licence: "CC0-1.0" });
    expect(await response.json()).toMatchObject({ licence: "CC-BY-SA-4.0" });
  });

  it("keeps the pseudonym on the text and gives it to an account without one", async () => {
    const cookie = await signedIn("learner@example.test");
    await submit(cookie, { ...text, attribution: { kind: "pseudonym", name: " 小明 " } });
    await submit(cookie, { ...text, attribution: { kind: "pseudonym", name: "小红" } });
    const rows = await db.select().from(submission).orderBy(submission.createdAt);
    expect(rows.map(({ attribution }) => attribution).sort()).toEqual(["小明", "小红"]);
    const [account] = await db.select({ name: user.name }).from(user);
    expect(account?.name).toBe("小明");
  });

  it("refuses an invalid text with the fields at fault and records nothing", async () => {
    const cookie = await signedIn("learner@example.test");
    const response = await submit(cookie, { ...text, body: "字".repeat(20_001), title: "" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_REQUEST",
      message: "Invalid fields: title, body",
    });
    expect(await records()).toEqual([]);
  });

  it("refuses a sixth pending text", async () => {
    const cookie = await signedIn("learner@example.test");
    for (let index = 0; index < 5; index += 1) expect((await submit(cookie)).status).toBe(201);
    const response = await submit(cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SUBMISSION_LIMIT" });
    expect(await records()).toHaveLength(5);

    await db.update(submission).set({ status: "approved" });
    expect((await submit(cookie)).status).toBe(201);
  });
});

describe("GET /api/submissions", () => {
  it("lists only the learner's own texts, the latest first", async () => {
    const other = await signedIn("other@example.test");
    await submit(other);
    const cookie = await signedIn("learner@example.test");
    await submit(cookie, { ...text, title: "第一" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await submit(cookie, { ...text, title: "第二" });
    const response = await call("/api/submissions", "GET", null, cookie);
    expect(response.status).toBe(200);
    const listed = Submissions.parse(await response.json());
    expect(listed.map(({ title }) => title)).toEqual(["第二", "第一"]);
  });
});

describe("DELETE /api/submissions/:id", () => {
  it("withdraws a pending text and records the deletion", async () => {
    const cookie = await signedIn("learner@example.test");
    const { id } = Submission.parse(await (await submit(cookie)).json());
    const response = await call(`/api/submissions/${id}`, "DELETE", null, cookie);
    expect(response.status).toBe(204);
    expect(await db.select().from(submission)).toEqual([]);
    expect((await records()).map(({ operation }) => operation)).toEqual(["create", "delete"]);
  });

  it("refuses another account's text and a text no longer pending", async () => {
    const owner = await signedIn("owner@example.test");
    const { id } = Submission.parse(await (await submit(owner)).json());
    const cookie = await signedIn("learner@example.test");
    const foreign = await call(`/api/submissions/${id}`, "DELETE", null, cookie);
    expect(foreign.status).toBe(404);

    await db.update(submission).set({ status: "approved" }).where(eq(submission.id, id));
    const approved = await call(`/api/submissions/${id}`, "DELETE", null, owner);
    expect(approved.status).toBe(409);
    expect(await approved.json()).toMatchObject({ code: "SUBMISSION_NOT_PENDING" });
    expect(await records()).toHaveLength(1);
  });
});

describe("hosting_record", () => {
  it("records the HTTP and TLS versions Cloudflare passes", async () => {
    const cookie = await signedIn("learner@example.test");
    const request = new Request(`${ORIGIN}/api/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify(text),
    });
    Object.defineProperty(request, "cf", {
      value: { httpProtocol: "HTTP/3", tlsVersion: "TLSv1.3" },
    });
    expect((await app.fetch(request, env)).status).toBe(201);
    expect(await records()).toMatchObject([{ ipAddress: null, protocol: "HTTP/3 TLSv1.3" }]);
  });

  it("outlives the account", async () => {
    const cookie = await signedIn("learner@example.test");
    await submit(cookie);
    await db.delete(user);
    expect(await db.select().from(submission)).toEqual([]);
    expect(await records()).toHaveLength(1);
  });
});
