import { NoticeDecided, NoticeReceipt, Notices } from "@openlinguo/core/moderation";
import { err } from "@openlinguo/core/result";
import { Submission } from "@openlinguo/core/submission";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SendMail } from "./mail.ts";
import { NOTICE_LIMIT } from "./notices.ts";
import {
  codeRequest,
  database,
  decision,
  hostingRecord,
  notice,
  rateLimit,
  securityEvent,
  session,
  submission,
  twoFactor,
  user,
} from "./schema.ts";
import { memoryMailer } from "./testing/memory-mailer.ts";
import { migratedPlatform } from "./testing/platform.ts";
import { totp } from "./testing/totp.ts";

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
  LETTERMINT_API_TOKEN: "lm_test_token",
  MAIL_FROM: "no-reply@example.test",
  CONTACT_EMAIL: "contact@example.test",
  SIGNUPS_OPEN: "true",
};
afterAll(() => platform.dispose());

let mailer = memoryMailer();
let sendMail: SendMail = mailer.sendMail;
const app = createApp([], () => (mail) => sendMail(mail));
let ip = 0;
beforeEach(async () => {
  for (const table of [
    codeRequest,
    securityEvent,
    notice,
    decision,
    hostingRecord,
    submission,
    twoFactor,
    session,
    rateLimit,
    user,
  ]) {
    await db.delete(table);
  }
  mailer = memoryMailer();
  sendMail = mailer.sendMail;
  ip += 1;
});

const call = async (path: string, body: object | null = null, cookie: string | null = null) =>
  app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "cf-connecting-ip": `198.51.100.${String(ip)}`,
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");

const signedIn = async (email: string) => {
  await call("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  const otp = /\b(\d{6})\b/.exec(mailer.sent.at(-1)?.text ?? "")?.[1];
  if (!otp) throw new Error("no code mailed");
  const cookie = cookiesOf(await call("/api/auth/sign-in/email-otp", { email, otp }));
  expect((await call("/api/account/age", { answer: "15-or-over" }, cookie)).status).toBe(204);
  return cookie;
};

const signedInAdmin = async () => {
  const cookie = await signedIn("admin@example.test");
  await db.update(user).set({ role: "admin" }).where(eq(user.email, "admin@example.test"));
  const enabled = await call("/api/auth/two-factor/enable", {}, cookie);
  const { totpURI } = await enabled.json<{ totpURI: string }>();
  const verified = await call("/api/auth/two-factor/verify-totp", { code: totp(totpURI) }, cookie);
  expect(verified.status).toBe(200);
  return cookiesOf(verified);
};

/** A text of `learner@example.test`, published. */
const published = async (title = "我的周末") => {
  const cookie = await signedIn("learner@example.test");
  const sent = await call(
    "/api/submissions",
    {
      origin: "human",
      provenance: null,
      title,
      body: "我周末去公园。",
      attribution: { kind: "anonymous" },
      attestationVersion: 1,
    },
    cookie,
  );
  const { id } = Submission.parse(await sent.json());
  await db
    .update(submission)
    .set({ status: "approved", band: 1, publishedAt: new Date() })
    .where(eq(submission.id, id));
  mailer = memoryMailer();
  sendMail = mailer.sendMail;
  return id;
};

const report = (submissionId: string, change: object = {}) => ({
  submissionId,
  reason: "copyright",
  explanation: "Copié du manuel, leçon 3.",
  name: "Lin Wei",
  email: "lin@example.test",
  goodFaith: true,
  ...change,
});

const noticed = async (submissionId: string, change: object = {}) => {
  const response = await call("/api/notices", report(submissionId, change));
  expect(response.status).toBe(201);
  return NoticeReceipt.parse(await response.json());
};

const statusOf = async (id: string) =>
  (await db.select({ status: submission.status }).from(submission).where(eq(submission.id, id)))[0]
    ?.status;

const statement = {
  ground: "copyright",
  facts: "Le texte reprend la leçon 3 d'un manuel publié.",
  explanation: "Il est reproduit sans l'accord de son éditeur.",
};

describe("POST /api/notices", () => {
  it("keeps a notice with no account and mails its receipt", async () => {
    const id = await published();
    const receipt = await noticed(id);
    expect(receipt.receipt).toBe("sent");
    const [stored] = await db.select().from(notice);
    expect(stored).toMatchObject({
      id: receipt.id,
      submissionId: id,
      reason: "copyright",
      name: "Lin Wei",
      email: "lin@example.test",
      outcome: null,
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("lin@example.test");
    expect(mailer.sent[0]?.text).toContain(`signalement ${receipt.id}`);
    expect(mailer.sent[0]?.text).toContain("« 我的周末 »");
  });

  it("takes a child sexual abuse report with no name and no email", async () => {
    const id = await published();
    const receipt = await noticed(id, { reason: "child-sexual-abuse", name: null, email: null });
    expect(receipt.receipt).toBe("none");
    expect(mailer.sent).toEqual([]);
  });

  it("says when the receipt could not be sent, and keeps the notice", async () => {
    const id = await published();
    sendMail = () => Promise.resolve(err({ kind: "unreachable", message: "down" }));
    expect((await noticed(id)).receipt).toBe("failed");
    expect(await db.select().from(notice)).toHaveLength(1);
  });

  it("refuses a notice without the notifier, or on a text not published", async () => {
    const id = await published();
    const anonymous = await call("/api/notices", report(id, { email: null }));
    expect(anonymous.status).toBe(400);
    expect(await anonymous.json()).toMatchObject({ code: "INVALID_REQUEST" });
    await db.update(submission).set({ status: "removed" }).where(eq(submission.id, id));
    const removed = await call("/api/notices", report(id));
    expect(removed.status).toBe(404);
    expect(await db.select().from(notice)).toEqual([]);
  });

  it(`takes at most ${String(NOTICE_LIMIT.max)} notices per address in a window`, async () => {
    const id = await published();
    for (let count = 0; count < NOTICE_LIMIT.max; count += 1) await noticed(id);
    const refused = await call("/api/notices", report(id));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    ip += 1;
    await noticed(id);
  });
});

describe("notices in /api/admin", () => {
  it("are refused to a learner", async () => {
    const id = await published();
    const { id: noticeId } = await noticed(id);
    const learner = await signedIn("other@example.test");
    for (const [path, body] of [
      ["/api/admin/notices", null],
      [`/api/admin/notices/${noticeId}/keep`, { reply: "Rien d'illégal." }],
      [`/api/admin/notices/${noticeId}/remove`, statement],
    ] as const) {
      expect((await call(path, body, learner)).status).toBe(403);
    }
  });

  it("lists the open notices first, the oldest first, with the text's title", async () => {
    const id = await published("我的猫");
    const first = await noticed(id);
    const second = await noticed(id, { reason: "library-rules" });
    const admin = await signedInAdmin();
    await call(`/api/admin/notices/${first.id}/keep`, { reply: "Rien d'illégal." }, admin);
    const listed = Notices.parse(await (await call("/api/admin/notices", null, admin)).json());
    expect(listed.map(({ id: noticeId }) => noticeId)).toEqual([second.id, first.id]);
    expect(listed[0]).toMatchObject({ title: "我的猫", reason: "library-rules", decision: null });
    expect(listed[1]?.decision).toMatchObject({ outcome: "kept", reply: "Rien d'illégal." });
  });

  it("keeps the text and tells the notifier, once", async () => {
    const id = await published();
    const { id: noticeId } = await noticed(id);
    const admin = await signedInAdmin();
    mailer = memoryMailer();
    sendMail = mailer.sendMail;
    const kept = await call(
      `/api/admin/notices/${noticeId}/keep`,
      { reply: "Courte citation." },
      admin,
    );
    expect(kept.status).toBe(200);
    expect(NoticeDecided.parse(await kept.json())).toEqual({ unsent: [], statement: null });
    expect(await statusOf(id)).toBe("approved");
    expect(mailer.sent.map(({ to }) => to)).toEqual(["lin@example.test"]);
    expect(mailer.sent[0]?.text).toContain("reste publié");
    expect(mailer.sent[0]?.text).toContain("Courte citation.");
    expect(mailer.sent[0]?.text).toContain("contact@example.test");
    const again = await call(`/api/admin/notices/${noticeId}/keep`, { reply: "x" }, admin);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "NOTICE_DECIDED" });
  });

  it("removes the text: the submitter gets the statement, every notifier the decision", async () => {
    const id = await published();
    const { id: noticeId } = await noticed(id);
    const other = await noticed(id, { name: "Zhang", email: "zhang@example.test" });
    const anonymous = await noticed(id, { reason: "child-sexual-abuse", name: null, email: null });
    const admin = await signedInAdmin();
    mailer = memoryMailer();
    sendMail = mailer.sendMail;
    const removed = await call(`/api/admin/notices/${noticeId}/remove`, statement, admin);
    expect(removed.status).toBe(201);
    const decided = NoticeDecided.parse(await removed.json());
    expect(decided.unsent).toEqual([]);
    expect(decided.statement).toMatchObject({ measure: "removed", source: "notice" });
    expect(await statusOf(id)).toBe("removed");
    expect(await db.select({ source: decision.source }).from(decision)).toEqual([
      { source: "notice" },
    ]);
    const rows = await db.select().from(notice);
    expect(rows.map(({ outcome }) => outcome)).toEqual(["removed", "removed", "removed"]);
    expect(rows.every(({ reply }) => reply === statement.explanation)).toBe(true);

    expect(mailer.sent.map(({ to }) => to)).toEqual([
      "learner@example.test",
      "lin@example.test",
      "zhang@example.test",
    ]);
    const toSubmitter = mailer.sent[0]?.text ?? "";
    expect(toSubmitter).toContain("Origine : décision prise à la suite d'un signalement.");
    for (const identity of ["Lin Wei", "lin@example.test", "Zhang", noticeId, other.id]) {
      expect(toSubmitter).not.toContain(identity);
    }
    expect(mailer.sent[1]?.text).toContain("a été retiré");
    expect(mailer.sent[2]?.text).toContain(`signalement ${other.id}`);
    expect(anonymous.receipt).toBe("none");
  });

  it("keeps the removal when a notifier's mail fails, and names that notifier", async () => {
    const id = await published();
    const { id: noticeId } = await noticed(id);
    const admin = await signedInAdmin();
    sendMail = (mail) =>
      mail.to === "lin@example.test"
        ? Promise.resolve(err({ kind: "rejected", message: "mailbox full" }))
        : mailer.sendMail(mail);
    const removed = await call(`/api/admin/notices/${noticeId}/remove`, statement, admin);
    expect(removed.status).toBe(201);
    expect(NoticeDecided.parse(await removed.json()).unsent).toEqual(["lin@example.test"]);
    expect(await statusOf(id)).toBe("removed");
  });

  it("changes nothing when the statement of reasons cannot be mailed", async () => {
    const id = await published();
    const { id: noticeId } = await noticed(id);
    const admin = await signedInAdmin();
    sendMail = () => Promise.resolve(err({ kind: "unreachable", message: "down" }));
    const removed = await call(`/api/admin/notices/${noticeId}/remove`, statement, admin);
    expect(removed.status).toBe(502);
    expect(await statusOf(id)).toBe("approved");
    expect((await db.select().from(notice))[0]?.outcome).toBeNull();
  });
});
