import { err } from "@openlinguo/core/result";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JOBS, type JobContext, runJobs } from "./jobs.ts";
import { cutoffs, inactivityStep } from "./retention.ts";
import {
  DELETED_ACCOUNT,
  database,
  decision,
  erasure,
  hostingRecord,
  jobRun,
  notice,
  rateLimit,
  sealedIdentity,
  securityEvent,
  session,
  submission,
  user,
  verification,
} from "./schema.ts";
import { memoryMailer } from "./testing/memory-mailer.ts";
import { migratedPlatform } from "./testing/platform.ts";

const NOW = new Date("2026-11-01T03:17:00.000Z");
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const at = (iso: string) => new Date(iso);

describe("cutoffs", () => {
  it("dates each retention period back from now", () => {
    expect(cutoffs(NOW)).toEqual({
      securityEvents: at("2026-05-01T03:17:00.000Z"),
      rateLimits: at("2026-11-01T03:07:00.000Z"),
      undeclaredAccounts: at("2026-10-31T03:17:00.000Z"),
      hostingRecords: at("2025-11-01T03:17:00.000Z"),
      moderation: at("2025-11-01T03:17:00.000Z"),
      inactive: at("2024-11-01T03:17:00.000Z"),
      noticeGrace: at("2026-10-02T03:17:00.000Z"),
    });
  });
});

describe("inactivityStep", () => {
  const twoYearsAgo = at("2024-11-01T03:17:00.000Z");

  it("leaves an account used in the last 2 years", () => {
    expect(inactivityStep(new Date(twoYearsAgo.getTime() + 1), null, NOW)).toBe("none");
  });

  it("notifies an account unused for 2 years", () => {
    expect(inactivityStep(twoYearsAgo, null, NOW)).toBe("notify");
  });

  it("notifies again an account used after its last notice", () => {
    expect(inactivityStep(twoYearsAgo, at("2024-10-01T00:00:00.000Z"), NOW)).toBe("notify");
  });

  it("waits 30 days after the notice, then deletes", () => {
    expect(inactivityStep(twoYearsAgo, ago(29 * DAY_MS), NOW)).toBe("none");
    expect(inactivityStep(twoYearsAgo, ago(30 * DAY_MS), NOW)).toBe("delete");
  });
});

const platform = await migratedPlatform();
const db = database(platform.env.DB);
afterAll(() => platform.dispose());

const APP_URL = "https://openlinguo.example.test";
let mailer = memoryMailer();
const context = (overrides: Partial<JobContext> = {}): JobContext => ({
  db,
  now: NOW,
  outbox: () => ({ sendMail: mailer.sendMail, appUrl: APP_URL }),
  ...overrides,
});

beforeEach(async () => {
  mailer = memoryMailer();
  for (const table of [
    jobRun,
    securityEvent,
    notice,
    decision,
    hostingRecord,
    sealedIdentity,
    erasure,
    submission,
    session,
    verification,
    rateLimit,
    user,
  ]) {
    await db.delete(table);
  }
});

const THREE_YEARS_MS = 3 * 365 * DAY_MS;

const addUser = (id: string, fields: Partial<typeof user.$inferInsert> = {}) =>
  db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.test`,
    ageDeclaredAt: ago(THREE_YEARS_MS),
    createdAt: ago(THREE_YEARS_MS),
    ...fields,
  });

const addSession = (id: string, userId: string, expiresAt: Date, updatedAt: Date) =>
  db
    .insert(session)
    .values({ id, token: `token-${id}`, userId, expiresAt, createdAt: updatedAt, updatedAt });

const statuses = async () =>
  (await db.select().from(jobRun).orderBy(jobRun.id)).map(({ job, status }) => ({ job, status }));

const ids = async (rows: Promise<readonly { readonly id: string | number }[]>) =>
  (await rows).map(({ id }) => id).sort();

describe("the daily jobs", () => {
  it("purge in one run what is due and keep the rest", async () => {
    await addUser("fresh", { ageDeclaredAt: null, createdAt: ago(60 * MINUTE_MS) });
    await addUser("undeclared", { ageDeclaredAt: null, createdAt: ago(25 * 60 * MINUTE_MS) });
    await addUser("learner");
    await addUser("quiet");
    await addUser("gone", {
      activeAt: ago(2 * 365 * DAY_MS + 40 * DAY_MS),
      inactivityNoticeAt: ago(31 * DAY_MS),
    });
    await db.insert(user).values({ ...DELETED_ACCOUNT, createdAt: ago(THREE_YEARS_MS) });
    await addSession("live", "learner", new Date(NOW.getTime() + 5 * DAY_MS), ago(2 * DAY_MS));
    await addSession("expired", "learner", ago(60 * MINUTE_MS), ago(8 * DAY_MS));
    await db.insert(verification).values([
      { id: "used-up", identifier: "sign-in-otp-a@example.test", value: "1", expiresAt: ago(1) },
      {
        id: "valid",
        identifier: "sign-in-otp-b@example.test",
        value: "2",
        expiresAt: new Date(NOW.getTime() + 5 * MINUTE_MS),
      },
    ]);
    await db.insert(rateLimit).values([
      { id: "old", key: "old", count: 1, lastRequest: NOW.getTime() - 11 * MINUTE_MS },
      { id: "recent", key: "recent", count: 1, lastRequest: NOW.getTime() - 9 * MINUTE_MS },
    ]);
    await db.insert(securityEvent).values([
      { id: 1, type: "sign_in", method: "email-otp", createdAt: ago(190 * DAY_MS) },
      { id: 2, type: "sign_in", method: "email-otp", createdAt: ago(170 * DAY_MS) },
    ]);
    const record = { userId: "learner", submissionId: "s1", operation: "create" } as const;
    await db.insert(hostingRecord).values([
      { id: 1, ...record, createdAt: ago(366 * DAY_MS) },
      { id: 2, ...record, createdAt: ago(364 * DAY_MS) },
    ]);
    const until = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
    await db.insert(sealedIdentity).values([
      {
        userId: "past-email",
        email: "past@example.test",
        emailUntil: ago(1),
        pseudonyms: null,
        pseudonymsUntil: ago(DAY_MS),
      },
      {
        userId: "past-pseudonyms",
        email: "sealed@example.test",
        emailUntil: until(1000),
        pseudonyms: ["小明"],
        pseudonymsUntil: ago(1),
      },
      {
        userId: "kept",
        email: "kept@example.test",
        emailUntil: until(1000),
        pseudonyms: ["小红"],
        pseudonymsUntil: until(100),
      },
    ]);
    await db.insert(submission).values({
      id: "s1",
      userId: "learner",
      title: "我的周末",
      body: "我周末去公园。",
      origin: "human",
      licence: "CC-BY-SA-4.0",
      attestationVersion: 1,
      attestedAt: ago(400 * DAY_MS),
      status: "approved",
    });
    const statement = {
      submissionId: "s1",
      measure: "rejected",
      source: "own-initiative",
      ground: "duplicate-or-spam",
      facts: "facts",
      explanation: "explanation",
    } as const;
    await db.insert(decision).values([
      { id: "d-old", ...statement, decidedAt: ago(366 * DAY_MS) },
      { id: "d-recent", ...statement, decidedAt: ago(364 * DAY_MS) },
    ]);
    const report = { submissionId: "s1", reason: "copyright", explanation: "mine" } as const;
    const kept = { outcome: "kept", reply: "It stays." } as const;
    await db.insert(notice).values([
      {
        id: "n-old",
        ...report,
        ...kept,
        createdAt: ago(400 * DAY_MS),
        decidedAt: ago(366 * DAY_MS),
      },
      { id: "n-recent", ...report, ...kept, createdAt: ago(400 * DAY_MS), decidedAt: ago(DAY_MS) },
      { id: "n-open", ...report, createdAt: ago(400 * DAY_MS) },
    ]);

    await runJobs(context(), JOBS);

    expect(await statuses()).toEqual(JOBS.map(({ name }) => ({ job: name, status: "succeeded" })));
    expect(await ids(db.select({ id: user.id }).from(user))).toEqual(
      [DELETED_ACCOUNT.id, "fresh", "learner", "quiet"].sort(),
    );
    const [learner] = await db.select().from(user).where(eq(user.id, "learner"));
    expect(learner?.activeAt).toEqual(ago(2 * DAY_MS));
    expect(learner?.inactivityNoticeAt).toBeNull();
    const [quiet] = await db.select().from(user).where(eq(user.id, "quiet"));
    expect(quiet?.inactivityNoticeAt).toEqual(NOW);
    expect(mailer.sent.map(({ to }) => to)).toEqual(["quiet@example.test"]);
    expect(mailer.sent[0]?.text).toContain("2026-12-01");
    expect(mailer.sent[0]?.text).toContain(`${APP_URL}/profile/account`);
    expect(await db.select().from(erasure)).toEqual([
      {
        userId: "gone",
        published: "keep-anonymous",
        ipAddress: null,
        protocol: null,
        erasedAt: NOW,
      },
    ]);
    expect(await ids(db.select({ id: session.id }).from(session))).toEqual(["live"]);
    expect(await ids(db.select({ id: verification.id }).from(verification))).toEqual(["valid"]);
    expect(await ids(db.select({ id: rateLimit.id }).from(rateLimit))).toEqual(["recent"]);
    expect(await ids(db.select({ id: securityEvent.id }).from(securityEvent))).toEqual([2]);
    expect(await ids(db.select({ id: hostingRecord.id }).from(hostingRecord))).toEqual([2]);
    expect(
      await db
        .select({ userId: sealedIdentity.userId, pseudonyms: sealedIdentity.pseudonyms })
        .from(sealedIdentity)
        .orderBy(sealedIdentity.userId),
    ).toEqual([
      { userId: "kept", pseudonyms: ["小红"] },
      { userId: "past-pseudonyms", pseudonyms: null },
    ]);
    expect(await ids(db.select({ id: decision.id }).from(decision))).toEqual(["d-recent"]);
    expect(await ids(db.select({ id: notice.id }).from(notice))).toEqual(["n-open", "n-recent"]);
  });

  it("keep an account whose notice failed, notify the others, then fail the job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => null);
    await addUser("bounced");
    await addUser("quiet");
    const sendMail = mailer.sendMail;
    mailer = {
      sent: mailer.sent,
      sendMail: (mail) =>
        mail.to === "bounced@example.test"
          ? Promise.resolve(err({ kind: "rejected", message: "422 invalid recipient" }))
          : sendMail(mail),
    };

    await runJobs(context(), JOBS);

    expect(await statuses()).toContainEqual({ job: "inactive-accounts", status: "failed" });
    expect(console.error).toHaveBeenCalledWith(
      "job inactive-accounts failed",
      new Error("Inactivity job failed: bounced: 422 invalid recipient"),
    );
    const rows = await db
      .select({ id: user.id, noticeAt: user.inactivityNoticeAt })
      .from(user)
      .orderBy(user.id);
    expect(rows).toEqual([
      { id: "bounced", noticeAt: null },
      { id: "quiet", noticeAt: NOW },
    ]);
  });

  it("fail only the inactivity job when the mail settings are missing, with no one to notify", async () => {
    vi.spyOn(console, "error").mockImplementation(() => null);
    await addUser("learner", { activeAt: ago(DAY_MS) });
    await addUser("gone", {
      activeAt: ago(2 * 365 * DAY_MS + 40 * DAY_MS),
      inactivityNoticeAt: ago(31 * DAY_MS),
    });

    await runJobs(
      context({
        outbox: () => {
          throw new Error("Mail settings missing or invalid: SCW_SECRET_KEY");
        },
      }),
      JOBS,
    );

    expect(await statuses()).toEqual(
      JOBS.map(({ name }) => ({
        job: name,
        status: name === "inactive-accounts" ? "failed" : "succeeded",
      })),
    );
    expect(console.error).toHaveBeenCalledWith(
      "job inactive-accounts failed",
      new Error(
        "Inactivity job failed: mail settings: Mail settings missing or invalid: SCW_SECRET_KEY",
      ),
    );
    expect(await db.select({ id: user.id }).from(user)).toEqual([{ id: "learner" }]);
  });
});
