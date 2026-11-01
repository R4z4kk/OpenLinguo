import { StatementOfReasons } from "@openlinguo/core/moderation";
import { err } from "@openlinguo/core/result";
import { Submission, Submissions } from "@openlinguo/core/submission";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { SendMail } from "./mail.ts";
import {
  codeRequest,
  DELETED_ACCOUNT,
  database,
  decision,
  erasure,
  hostingRecord,
  sealedIdentity,
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
    decision,
    hostingRecord,
    sealedIdentity,
    erasure,
    submission,
    twoFactor,
    session,
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

/** An admin whose session verified a TOTP code computed here. */
const signedInAdmin = async () => {
  const cookie = await signedIn("admin@example.test");
  await db.update(user).set({ role: "admin" }).where(eq(user.email, "admin@example.test"));
  const enabled = await call("/api/auth/two-factor/enable", {}, cookie);
  const { totpURI } = await enabled.json<{ totpURI: string }>();
  const verified = await call("/api/auth/two-factor/verify-totp", { code: totp(totpURI) }, cookie);
  expect(verified.status).toBe(200);
  return cookiesOf(verified);
};

const text = {
  origin: "human",
  provenance: null,
  title: "我的周末",
  body: "我周末去公园。",
  attribution: { kind: "anonymous" },
  attestationVersion: 1,
};

const submitted = async (cookie: string, title = text.title) =>
  Submission.parse(await (await call("/api/submissions", { ...text, title }, cookie)).json());

const statement = {
  ground: "copyright",
  facts: "Le texte reprend le premier chapitre d'un roman publié.",
  explanation: "Il est reproduit sans l'accord de son auteur.",
};

const statusOf = async (id: string) =>
  (await db.select({ status: submission.status }).from(submission).where(eq(submission.id, id)))[0]
    ?.status;

const adminActions = async () =>
  (await db.select().from(securityEvent).where(eq(securityEvent.type, "admin_action"))).map(
    ({ method, target }) => ({ method, target }),
  );

describe("moderation access", () => {
  it("refuses a learner who is not admin on every route", async () => {
    const learner = await signedIn("learner@example.test");
    const { id } = await submitted(learner);
    for (const [path, body] of [
      ["/api/admin/queue", null],
      [`/api/admin/submissions/${id}`, null],
      [`/api/admin/submissions/${id}/approve`, { band: 1 }],
      [`/api/admin/submissions/${id}/reject`, statement],
      ["/api/admin/accounts/delete", { email: "admin@example.test" }],
    ] as const) {
      const refused = await call(path, body, learner);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "ADMIN_REQUIRED" });
    }
    expect(await statusOf(id)).toBe("pending");
    expect(await db.select().from(decision)).toEqual([]);
  });
});

describe("GET /api/admin/queue", () => {
  it("lists the pending texts of every account, the oldest first", async () => {
    const learner = await signedIn("learner@example.test");
    await submitted(learner, "第一");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { id } = await submitted(learner, "第二");
    await submitted(await signedIn("other@example.test"), "第三");
    await db.update(submission).set({ status: "approved" }).where(eq(submission.id, id));
    const admin = await signedInAdmin();
    const response = await call("/api/admin/queue", null, admin);
    expect(response.status).toBe(200);
    const queue = Submissions.parse(await response.json());
    expect(queue.map(({ title }) => title)).toEqual(["第一", "第三"]);
  });
});

describe("POST /api/admin/submissions/:id/approve", () => {
  it("publishes the text with its estimated band and records the action", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    const admin = await signedInAdmin();
    const response = await call(`/api/admin/submissions/${id}/approve`, { band: 2 }, admin);
    expect(response.status).toBe(204);
    const [row] = await db.select().from(submission).where(eq(submission.id, id));
    expect(row).toMatchObject({ status: "approved", band: 2 });
    expect(Date.now() - (row?.publishedAt?.getTime() ?? 0)).toBeLessThan(60_000);
    expect(await adminActions()).toEqual([{ method: "moderation/approve", target: id }]);
    expect(mailer.sent.filter(({ to }) => to === "learner@example.test")).toHaveLength(1);
  });

  it("refuses an invalid band, an unknown text and a text no longer pending", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    const admin = await signedInAdmin();
    const invalid = await call(`/api/admin/submissions/${id}/approve`, { band: 8 }, admin);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      code: "INVALID_REQUEST",
      message: "Invalid fields: band",
    });
    const unknown = await call("/api/admin/submissions/nope/approve", { band: 1 }, admin);
    expect(unknown.status).toBe(404);
    await call(`/api/admin/submissions/${id}/approve`, { band: 1 }, admin);
    const again = await call(`/api/admin/submissions/${id}/approve`, { band: 3 }, admin);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "SUBMISSION_NOT_PENDING" });
    const [row] = await db.select({ band: submission.band }).from(submission);
    expect(row?.band).toBe(1);
  });
});

describe("POST /api/admin/submissions/:id/reject", () => {
  it("mails the statement of reasons in French and English, then stores it", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    const admin = await signedInAdmin();
    const response = await call(`/api/admin/submissions/${id}/reject`, statement, admin);
    expect(response.status).toBe(201);
    const decided = StatementOfReasons.parse(await response.json());
    expect(decided).toMatchObject({
      ...statement,
      submissionId: id,
      measure: "rejected",
      source: "own-initiative",
      automated: false,
    });
    expect(await statusOf(id)).toBe("rejected");
    const [stored] = await db.select().from(decision);
    expect(stored).toMatchObject({ id: decided.id, measure: "rejected", ground: "copyright" });
    expect(stored?.decidedAt.toISOString()).toBe(decided.decidedAt);

    const mail = mailer.sent.at(-1);
    expect(mail?.to).toBe("learner@example.test");
    expect(mail?.subject).toBe(
      "OpenLinguo : votre texte n'a pas été publié / your text was not published",
    );
    for (const part of [
      "Votre texte « 我的周末 » n'a pas été publié",
      "Mesure : refus de publication.",
      "Origine : décision prise à l'initiative de l'administrateur, sans signalement.",
      "Motif : contenu illégal, atteinte au droit d'auteur (Code de la propriété intellectuelle, art. L122-4).",
      `Faits : ${statement.facts}`,
      `Explication : ${statement.explanation}`,
      "Moyens automatisés : aucun.",
      "en écrivant à contact@example.test",
      'Your text "我的周末" was not published',
      "Ground: illegal content, copyright infringement",
      "Automated means: none.",
      "by writing to contact@example.test",
    ]) {
      expect(mail?.text).toContain(part);
    }
    expect(await adminActions()).toEqual([{ method: "moderation/reject", target: id }]);
  });

  it("cites the clause of the terms for a library rule", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    const admin = await signedInAdmin();
    await call(
      `/api/admin/submissions/${id}/reject`,
      { ...statement, ground: "not-chinese" },
      admin,
    );
    expect(mailer.sent.at(-1)?.text).toContain(
      "Motif : règles de la bibliothèque, article 3.2 des conditions d'utilisation : le texte n'est pas en chinois.",
    );
  });

  it("stores nothing when the mail cannot be sent", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    const admin = await signedInAdmin();
    sendMail = () => Promise.resolve(err({ kind: "unreachable", message: "down" }));
    const response = await call(`/api/admin/submissions/${id}/reject`, statement, admin);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "MAIL_FAILED" });
    expect(await statusOf(id)).toBe("pending");
    expect(await db.select().from(decision)).toEqual([]);
    expect(await adminActions()).toEqual([]);
  });

  it("refuses a statement without facts, and a text already decided", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    const admin = await signedInAdmin();
    const empty = await call(
      `/api/admin/submissions/${id}/reject`,
      { ...statement, facts: " " },
      admin,
    );
    expect(empty.status).toBe(400);
    await call(`/api/admin/submissions/${id}/approve`, { band: 1 }, admin);
    const sent = mailer.sent.length;
    const late = await call(`/api/admin/submissions/${id}/reject`, statement, admin);
    expect(late.status).toBe(409);
    expect(mailer.sent).toHaveLength(sent);
  });
});

describe("POST /api/admin/submissions/:id/remove", () => {
  it("removes a published text with a statement of reasons", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    const admin = await signedInAdmin();
    const pending = await call(`/api/admin/submissions/${id}/remove`, statement, admin);
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ code: "SUBMISSION_NOT_APPROVED" });

    await call(`/api/admin/submissions/${id}/approve`, { band: 1 }, admin);
    const removed = await call(
      `/api/admin/submissions/${id}/remove`,
      { ...statement, ground: "hate" },
      admin,
    );
    expect(removed.status).toBe(201);
    expect(await removed.json()).toMatchObject({ measure: "removed", ground: "hate" });
    expect(await statusOf(id)).toBe("removed");
    expect(mailer.sent.at(-1)?.text).toContain("Mesure : retrait.");
    expect(mailer.sent.at(-1)?.text).toContain("Measure: removal.");
  });
});

describe("decision", () => {
  it("is deleted with the text and its account", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    const admin = await signedInAdmin();
    await call(`/api/admin/submissions/${id}/reject`, statement, admin);
    expect(await db.select().from(decision)).toHaveLength(1);
    await db.delete(user).where(eq(user.email, "learner@example.test"));
    expect(await db.select().from(decision)).toEqual([]);
  });
});

describe("a kept text of a deleted account", () => {
  it("is removed with the statement stored and no mail to send", async () => {
    const { id } = await submitted(await signedIn("learner@example.test"));
    await db
      .insert(user)
      .values({ ...DELETED_ACCOUNT, emailVerified: false })
      .onConflictDoNothing();
    await db
      .update(submission)
      .set({ status: "approved", userId: DELETED_ACCOUNT.id })
      .where(eq(submission.id, id));
    const admin = await signedInAdmin();
    const before = mailer.sent.length;
    const response = await call(`/api/admin/submissions/${id}/remove`, statement, admin);
    expect(response.status).toBe(201);
    expect(mailer.sent.length).toBe(before);
    expect(await statusOf(id)).toBe("removed");
    expect(await db.select({ source: decision.source }).from(decision)).toEqual([
      { source: "own-initiative" },
    ]);
  });
});

describe("POST /api/admin/accounts/delete", () => {
  it("deletes an account by its address, keeps its published texts without a name, and records it", async () => {
    const learner = await signedIn("learner@example.test");
    const { id } = await submitted(learner);
    await db
      .update(submission)
      .set({ status: "approved", attribution: "小明" })
      .where(eq(submission.id, id));
    const [found] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "learner@example.test"));
    const admin = await signedInAdmin();

    const response = await call(
      "/api/admin/accounts/delete",
      { email: "Learner@Example.test" },
      admin,
    );
    expect(response.status).toBe(204);
    expect(await db.select().from(user).where(eq(user.email, "learner@example.test"))).toEqual([]);
    expect(
      await db
        .select({ userId: submission.userId, attribution: submission.attribution })
        .from(submission),
    ).toEqual([{ userId: DELETED_ACCOUNT.id, attribution: null }]);
    expect(await db.select({ email: sealedIdentity.email }).from(sealedIdentity)).toEqual([
      { email: "learner@example.test" },
    ]);
    expect(
      await db.select({ userId: erasure.userId, published: erasure.published }).from(erasure),
    ).toEqual([{ userId: found?.id, published: "keep-anonymous" }]);
    expect(await adminActions()).toContainEqual({
      method: "moderation/delete-account",
      target: found?.id ?? "",
    });
  });

  it("refuses an unknown address, an admin account, the placeholder and a missing address", async () => {
    const admin = await signedInAdmin();
    await db
      .insert(user)
      .values({ ...DELETED_ACCOUNT, emailVerified: false })
      .onConflictDoNothing();
    const unknown = await call(
      "/api/admin/accounts/delete",
      { email: "nobody@example.test" },
      admin,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "NOT_FOUND" });
    for (const body of [{ email: "admin@example.test" }, { email: DELETED_ACCOUNT.email }, {}]) {
      const refused = await call("/api/admin/accounts/delete", body, admin);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(await db.select({ id: user.id }).from(user).where(eq(user.role, "admin"))).toHaveLength(
      1,
    );
  });
});
