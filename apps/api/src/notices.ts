import type { ApiError } from "@openlinguo/core/api-error";
import { NewNotice, type NoticeReceipt } from "@openlinguo/core/moderation";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { noticeReceiptMail } from "./mail-templates.ts";
import type { Moderation } from "./moderation.ts";
import { withinLimit } from "./rate-limit.ts";
import { database, notice, submission } from "./schema.ts";

/** Notices per address and window; Better Auth's own rules cover `/api/auth/*` only. */
export const NOTICE_LIMIT = { windowMs: 10 * 60_000, max: 5 } as const;

const refusal = (code: ApiError["code"], message: string): ApiError => ({ code, message });

/** `/api/notices`: « Signaler », with no account (DSA art. 16). */
export const noticeRoutes = (moderationOf: (env: Env) => Moderation) =>
  new Hono<{ Bindings: Env }>().post("/", async (c) => {
    const db = database(c.env.DB);
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    if (!(await withinLimit(db, `notice:${ip}`, NOTICE_LIMIT, Date.now()))) {
      return c.json(refusal("TOO_MANY_ATTEMPTS", "Too many notices, try again later"), 429);
    }
    const parsed = NewNotice.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map(({ path }) => path.join(".")))];
      return c.json(refusal("INVALID_REQUEST", `Invalid fields: ${fields.join(", ")}`), 400);
    }
    const { submissionId, reason, explanation, name, email } = parsed.data;
    const fields = { submissionId, reason, explanation, name, email };
    const [text] = await db
      .select({ title: submission.title })
      .from(submission)
      .where(and(eq(submission.id, fields.submissionId), eq(submission.status, "approved")));
    if (!text) return c.json(refusal("NOT_FOUND", "No such text in the library"), 404);
    const row = { ...fields, id: crypto.randomUUID(), createdAt: new Date() };
    await db.insert(notice).values(row);
    let receipt: NoticeReceipt["receipt"] = "none";
    if (row.email !== null) {
      const sent = await moderationOf(c.env).sendMail(
        noticeReceiptMail(row.email, { id: row.id, title: text.title, reason: row.reason }),
      );
      if (!sent.ok) console.error("notice receipt not sent", sent.error);
      receipt = sent.ok ? "sent" : "failed";
    }
    const body: NoticeReceipt = { id: row.id, createdAt: row.createdAt.toISOString(), receipt };
    return c.json(body, 201);
  });
