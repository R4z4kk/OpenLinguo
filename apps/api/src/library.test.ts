import { ApiError } from "@openlinguo/core/api-error";
import { LIBRARY_PAGE_SIZE, LibraryItem, LibraryPage } from "@openlinguo/core/submission";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { database, submission, user } from "./schema.ts";
import { memoryMailer } from "./testing/memory-mailer.ts";
import { migratedPlatform } from "./testing/platform.ts";

const ORIGIN = "https://openlinguo.example.test";
const platform = await migratedPlatform();
const db = database(platform.env.DB);
afterAll(() => platform.dispose());

const app = createApp([], () => memoryMailer().sendMail);
const USER_ID = "u1";

beforeEach(async () => {
  for (const table of [submission, user]) await db.delete(table);
  await db.insert(user).values({ id: USER_ID, name: "小明", email: "learner@example.test" });
});

const provenance = {
  origin: "ai",
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  promptVersion: "zh-story-v1",
  createdAt: "2026-10-30T09:00:00.000Z",
} as const;

let order = 0;
const stored = async (
  status: "pending" | "approved" | "rejected" | "removed",
  changes: Partial<typeof submission.$inferInsert> = {},
) => {
  order += 1;
  const approved = status === "approved" || status === "removed";
  const row = {
    id: crypto.randomUUID(),
    userId: USER_ID,
    title: `文章${String(order)}`,
    body: "我周末去公园。",
    origin: "human" as const,
    provenance: null,
    licence: "CC-BY-SA-4.0" as const,
    attribution: null,
    attestationVersion: 1,
    attestedAt: new Date(),
    status,
    band: approved ? 2 : null,
    publishedAt: approved ? new Date(Date.UTC(2026, 9, 1) + order * 60_000) : null,
    ...changes,
  };
  await db.insert(submission).values(row);
  return row.id;
};

const get = (path: string) => app.fetch(new Request(`${ORIGIN}${path}`), platform.env);

const pageOf = async (path: string) => {
  const response = await get(path);
  expect(response.status).toBe(200);
  return LibraryPage.parse(await response.json());
};

describe("GET /api/library", () => {
  it("lists approved texts only, the latest published first, without their body", async () => {
    await stored("pending");
    const older = await stored("approved", { attribution: "小明" });
    await stored("rejected");
    await stored("removed");
    const story = await stored("approved", { origin: "ai", provenance, licence: "CC0-1.0" });
    const page = await pageOf("/api/library");
    expect(page.items.map(({ id }) => id)).toEqual([story, older]);
    expect(page.items[0]).toMatchObject({ origin: "ai", provenance, licence: "CC0-1.0" });
    expect(page.items[1]).toMatchObject({ attribution: "小明", band: 2 });
    expect(page.items[0]).not.toHaveProperty("body");
    expect(page.nextPage).toBeNull();
  });

  it("filters by band", async () => {
    await stored("approved", { band: 1 });
    const second = await stored("approved", { band: 3 });
    const page = await pageOf("/api/library?band=3");
    expect(page.items.map(({ id }) => id)).toEqual([second]);
  });

  it("pages through the texts", async () => {
    for (let index = 0; index <= LIBRARY_PAGE_SIZE; index += 1) await stored("approved");
    const first = await pageOf("/api/library");
    expect(first.items).toHaveLength(LIBRARY_PAGE_SIZE);
    expect(first.nextPage).toBe(2);
    const second = await pageOf("/api/library?page=2");
    expect(second.items).toHaveLength(1);
    expect(second.nextPage).toBeNull();
    expect(first.items.map(({ id }) => id)).not.toContain(second.items[0]?.id);
  });

  it("lets browsers and shared caches keep an answer one minute", async () => {
    const response = await get("/api/library");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it.each(["band=0", "band=x", "page=0", "page=-1"])("refuses ?%s", async (query) => {
    const response = await get(`/api/library?${query}`);
    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).code).toBe("INVALID_REQUEST");
    expect(response.headers.get("cache-control")).toBeNull();
  });
});

describe("GET /api/library/:id", () => {
  it("answers an approved text with its body", async () => {
    const id = await stored("approved", { attribution: "小明" });
    const response = await get(`/api/library/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(LibraryItem.parse(await response.json())).toMatchObject({
      id,
      body: "我周末去公园。",
      attribution: "小明",
      licence: "CC-BY-SA-4.0",
    });
  });

  it.each(["pending", "rejected", "removed"] as const)("hides a %s text", async (status) => {
    const id = await stored(status);
    const response = await get(`/api/library/${id}`);
    expect(response.status).toBe(404);
    expect(ApiError.parse(await response.json()).code).toBe("NOT_FOUND");
  });
});
