import { eq } from "drizzle-orm";
import { type Database, rateLimit } from "./schema.ts";

/** Counts in Better Auth's `rate_limit` table, where `lastRequest` holds the window's start here. */
export const withinLimit = async (
  db: Database,
  key: string,
  limit: { readonly max: number; readonly windowMs: number },
  now: number,
): Promise<boolean> => {
  const [row] = await db.select().from(rateLimit).where(eq(rateLimit.key, key));
  if (!row || now - row.lastRequest >= limit.windowMs) {
    await db
      .insert(rateLimit)
      .values({ id: key, key, count: 1, lastRequest: now })
      .onConflictDoUpdate({ target: rateLimit.key, set: { count: 1, lastRequest: now } });
    return true;
  }
  if (row.count >= limit.max) return false;
  await db
    .update(rateLimit)
    .set({ count: row.count + 1 })
    .where(eq(rateLimit.key, key));
  return true;
};
