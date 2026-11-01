import { AccountExport } from "@openlinguo/core/account";
import { LibraryPage, Submission } from "@openlinguo/core/submission";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { reapplyErasures } from "./account.ts";
import { createApp } from "./app.ts";
import {
  account,
  DELETED_ACCOUNT,
  database,
  decision,
  erasure,
  hostingRecord,
  notice,
  sealedIdentity,
  securityEvent,
  session,
  submission,
  twoFactor,
  user,
} from "./schema.ts";
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
  LETTERMINT_API_TOKEN: "lm_test_token",
  MAIL_FROM: "no-reply@example.test",
  CONTACT_EMAIL: "contact@example.test",
  SIGNUPS_OPEN: "true",
};
afterAll(() => platform.dispose());

let mailer = memoryMailer();
const app = createApp([], () => (mail) => mailer.sendMail(mail));
let ip = 0;
beforeEach(async () => {
  for (const table of [
    securityEvent,
    notice,
    decision,
    hostingRecord,
    sealedIdentity,
    erasure,
    submission,
    twoFactor,
    session,
    account,
    user,
  ]) {
    await db.delete(table);
  }
  mailer = memoryMailer();
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

const EMAIL = "lin@example.test";

const signedIn = async (email = EMAIL, answerAge = true) => {
  await call("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  const otp = /\b(\d{6})\b/.exec(mailer.sent.at(-1)?.text ?? "")?.[1];
  if (!otp) throw new Error("no code mailed");
  const cookie = cookiesOf(await call("/api/auth/sign-in/email-otp", { email, otp }));
  if (answerAge) {
    expect((await call("/api/account/age", { answer: "15-or-over" }, cookie)).status).toBe(204);
  }
  return cookie;
};

const submitted = async (
  cookie: string,
  title: string,
  status: "pending" | "approved" | "rejected",
  pseudonym: string | null = "小林",
) => {
  const response = await call(
    "/api/submissions",
    {
      origin: "human",
      provenance: null,
      title,
      body: "我周末去公园。",
      attribution:
        pseudonym === null ? { kind: "anonymous" } : { kind: "pseudonym", name: pseudonym },
      attestationVersion: 1,
    },
    cookie,
  );
  const { id } = Submission.parse(await response.json());
  if (status !== "pending") {
    await db
      .update(submission)
      .set({ status, band: 1, publishedAt: status === "approved" ? new Date() : null })
      .where(eq(submission.id, id));
  }
  return id;
};

const userIdOf = async (email = EMAIL) =>
  (await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]?.id ?? null;

const texts = async () =>
  db
    .select({
      title: submission.title,
      userId: submission.userId,
      attribution: submission.attribution,
    })
    .from(submission);

const operations = async () =>
  (await db.select().from(hostingRecord)).map(({ operation }) => operation).sort();

describe("GET /api/account/export", () => {
  it("gives the account, sign-in methods, sessions, texts, decisions and events, no token", async () => {
    const cookie = await signedIn();
    const id = await submitted(cookie, "我的周末", "rejected");
    await db.insert(decision).values({
      id: "d1",
      submissionId: id,
      measure: "rejected",
      source: "own-initiative",
      ground: "not-chinese",
      facts: "f",
      explanation: "e",
      decidedAt: new Date(),
    });
    // An emailed code leaves no `account` row; a provider does.
    await db.insert(account).values({
      id: "a1",
      accountId: "4242",
      providerId: "github",
      userId: (await userIdOf()) ?? "",
      accessToken: "gho_secret",
    });
    const response = await call("/api/account/export", null, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const raw = await response.text();
    const exported = AccountExport.parse(JSON.parse(raw));
    expect(exported.account).toMatchObject({ email: EMAIL, pseudonym: "小林" });
    expect(exported.signInMethods.map(({ providerId }) => providerId)).toEqual(["github"]);
    expect(exported.sessions).toHaveLength(1);
    expect(exported.submissions.map(({ title }) => title)).toEqual(["我的周末"]);
    expect(exported.decisions.map(({ id: decided }) => decided)).toEqual(["d1"]);
    expect(exported.securityEvents.some(({ type }) => type === "sign_in")).toBe(true);
    const [stored] = await db.select({ token: session.token }).from(session);
    expect(raw).not.toContain(stored?.token ?? "no token");
    expect(raw).not.toContain("gho_secret");
  });

  it("answers 401 when signed out", async () => {
    expect((await call("/api/account/export")).status).toBe(401);
  });
});

describe("POST /api/account/delete", () => {
  it("removes every text with « remove », and seals the email and pseudonyms", async () => {
    const cookie = await signedIn();
    const userId = await userIdOf();
    await submitted(cookie, "已发表", "approved");
    await submitted(cookie, "等待", "pending", "Lin");
    await submitted(cookie, "拒绝", "rejected", null);
    const response = await call("/api/account/delete", { published: "remove" }, cookie);
    expect(response.status).toBe(204);
    expect(await db.select().from(user)).toEqual([]);
    expect(await db.select().from(session)).toEqual([]);
    expect(await texts()).toEqual([]);
    expect(await operations()).toEqual([
      "create",
      "create",
      "create",
      "delete",
      "delete",
      "delete",
    ]);
    const [sealed] = await db.select().from(sealedIdentity);
    expect(sealed).toMatchObject({ userId, email: EMAIL });
    expect(sealed?.pseudonyms?.toSorted()).toEqual(["Lin", "小林"]);
    const years = (until: Date | null) =>
      Math.round(((until?.getTime() ?? 0) - Date.now()) / (365 * 24 * 60 * 60 * 1000));
    expect(years(sealed?.emailUntil ?? null)).toBe(5);
    expect(years(sealed?.pseudonymsUntil ?? null)).toBe(1);
    expect(await db.select({ published: erasure.published }).from(erasure)).toEqual([
      { published: "remove" },
    ]);
    expect((await call("/api/auth/get-session", null, cookie)).status).toBe(200);
    expect(await (await call("/api/auth/get-session", null, cookie)).json()).toBeNull();
  });

  it("keeps the published texts with the signature under the placeholder account", async () => {
    const cookie = await signedIn();
    await submitted(cookie, "已发表", "approved");
    await submitted(cookie, "等待", "pending");
    await call("/api/account/delete", { published: "keep-named" }, cookie);
    expect(await texts()).toEqual([
      { title: "已发表", userId: DELETED_ACCOUNT.id, attribution: "小林" },
    ]);
    expect(await db.select({ id: user.id }).from(user)).toEqual([{ id: DELETED_ACCOUNT.id }]);
    const library = LibraryPage.parse(await (await call("/api/library")).json());
    expect(library.items.map(({ title }) => title)).toEqual(["已发表"]);
  });

  it("keeps the published texts without a name, recorded as an edit", async () => {
    const cookie = await signedIn();
    await submitted(cookie, "已发表", "approved");
    await call("/api/account/delete", { published: "keep-anonymous" }, cookie);
    expect(await texts()).toEqual([
      { title: "已发表", userId: DELETED_ACCOUNT.id, attribution: null },
    ]);
    expect(await operations()).toEqual(["create", "edit"]);
  });

  it("seals nothing for an account that never submitted", async () => {
    const cookie = await signedIn();
    expect(
      (await call("/api/account/delete", { published: "keep-anonymous" }, cookie)).status,
    ).toBe(204);
    expect(await db.select().from(user)).toEqual([]);
    expect(await db.select().from(sealedIdentity)).toEqual([]);
  });

  it("refuses a request without a choice, and a signed-out one", async () => {
    const cookie = await signedIn();
    expect((await call("/api/account/delete", { published: "keep" }, cookie)).status).toBe(400);
    expect((await call("/api/account/delete", { published: "remove" })).status).toBe(401);
    expect(await userIdOf()).not.toBeNull();
  });

  it("leaves Better Auth's deletion to the age step only", async () => {
    const cookie = await signedIn();
    await submitted(cookie, "已发表", "approved");
    const refused = await call("/api/auth/delete-user", {}, cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "USE_ACCOUNT_DELETION" });
    expect(await userIdOf()).not.toBeNull();
    const fresh = await signedIn("new@example.test", false);
    expect((await call("/api/auth/delete-user", {}, fresh)).status).toBe(200);
  });
});

describe("reapplyErasures", () => {
  const jobContext = {
    db,
    now: new Date(),
    outbox: () => ({ sendMail: mailer.sendMail, appUrl: ORIGIN }),
  };

  it("deletes an account again after a restore, with the learner's choice", async () => {
    const cookie = await signedIn();
    await submitted(cookie, "已发表", "approved");
    await submitted(cookie, "等待", "pending");
    const restoredUser = await db.select().from(user);
    const restoredTexts = await db.select().from(submission);
    await call("/api/account/delete", { published: "keep-anonymous" }, cookie);

    // A Time Travel restore brings the account back; the runbook puts the erasure log back.
    await db.delete(submission);
    await db.delete(sealedIdentity);
    await db.delete(user);
    await db.insert(user).values(restoredUser);
    await db.insert(submission).values(restoredTexts);
    await reapplyErasures.run(jobContext);

    expect(await db.select({ id: user.id }).from(user)).toEqual([{ id: DELETED_ACCOUNT.id }]);
    expect(await texts()).toEqual([
      { title: "已发表", userId: DELETED_ACCOUNT.id, attribution: null },
    ]);
    expect(await db.select({ email: sealedIdentity.email }).from(sealedIdentity)).toEqual([
      { email: EMAIL },
    ]);
  });

  it("forgets an erasure after 8 days", async () => {
    await db.insert(erasure).values({
      userId: "gone",
      published: "remove",
      erasedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
    });
    await reapplyErasures.run(jobContext);
    expect(await db.select().from(erasure)).toEqual([]);
  });
});
