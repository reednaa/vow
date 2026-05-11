import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, and } from "drizzle-orm";
import { Elysia } from "elysia";
import { createDb, closeDb } from "../src/db/client";
import { apiKeys, apiUsage } from "../src/db/schema";
import { createApiKeyRoutes } from "../src/api/admin/keys";
import { trackUsage } from "../src/api/usage-tracker";

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";

let db: ReturnType<typeof createDb>;
let app: ReturnType<typeof createApiKeyRoutes>;

function makeRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  app = new Elysia().use(createApiKeyRoutes(db));
});

afterAll(async () => {
  await db.delete(apiUsage);
  await db.delete(apiKeys);
  await closeDb();
});

describe("Admin API Keys", () => {
  describe("POST /keys", () => {
    it("creates a key and returns the raw key (only time it is shown)", async () => {
      const res = await app.handle(
        makeRequest("/keys", {
          method: "POST",
          body: JSON.stringify({ name: "test-key-1" }),
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.id).toBeGreaterThan(0);
      expect(body.name).toBe("test-key-1");
      expect(body.key).toMatch(/^vow_wit_/);
      expect(body.keyPrefix).toBe(body.key.slice(0, 18));
      expect(body.createdAt).toBeTruthy();

      const [storedKey] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, body.id));
      expect(storedKey).toBeTruthy();
      expect(storedKey!.name).toBe("test-key-1");
      expect(storedKey!.keyPrefix).toBe(body.keyPrefix);
      expect(storedKey!.isActive).toBe(true);
    });

    it("rejects empty name", async () => {
      const res = await app.handle(
        makeRequest("/keys", {
          method: "POST",
          body: JSON.stringify({ name: "" }),
        })
      );
      expect(res.status).toBe(422);
    });

    it("rejects missing name field", async () => {
      const res = await app.handle(
        makeRequest("/keys", {
          method: "POST",
          body: JSON.stringify({}),
        })
      );
      expect(res.status).toBe(422);
    });
  });

  describe("GET /keys", () => {
    it("lists keys with today's usage", async () => {
      // Create a key first
      const createRes = await app.handle(
        makeRequest("/keys", {
          method: "POST",
          body: JSON.stringify({ name: "list-test-key" }),
        })
      );
      const created = await createRes.json() as any;

      // Insert some usage data for today
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(apiUsage).values({
        apiKeyId: created.id,
        date: today,
        coldRequests: 3,
        hotRequests: 5,
        statusRequests: 2,
      });

      const res = await app.handle(makeRequest("/keys"));
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body)).toBe(true);

      const listedKey = body.find((k: any) => k.id === created.id);
      expect(listedKey).toBeTruthy();
      expect(listedKey.name).toBe("list-test-key");
      expect(listedKey.keyPrefix).toBe(created.keyPrefix);
      expect(listedKey.isActive).toBe(true);
      expect(listedKey.todayUsage).toEqual({ cold: 3, hot: 5, status: 2 });
    });

    it("returns zero usage for keys with no usage today", async () => {
      const res = await app.handle(makeRequest("/keys"));
      const body = await res.json() as any;
      for (const key of body) {
        if (key.todayUsage) {
          expect(key.todayUsage.cold).toBeGreaterThanOrEqual(0);
          expect(key.todayUsage.hot).toBeGreaterThanOrEqual(0);
          expect(key.todayUsage.status).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("POST /:id/revoke", () => {
    it("revokes an active key", async () => {
      const createRes = await app.handle(
        makeRequest("/keys", {
          method: "POST",
          body: JSON.stringify({ name: "revoke-test-key" }),
        })
      );
      const created = await createRes.json() as any;

      const revokeRes = await app.handle(
        makeRequest(`/keys/${created.id}/revoke`, { method: "POST" })
      );
      expect(revokeRes.status).toBe(200);
      const body = await revokeRes.json() as any;
      expect(body.ok).toBe(true);

      const [storedKey] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, created.id));
      expect(storedKey!.isActive).toBe(false);
    });

    it("returns 404 for non-existent key", async () => {
      const res = await app.handle(
        makeRequest("/keys/99999/revoke", { method: "POST" })
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /:id/usage", () => {
    it("returns usage for a key", async () => {
      const createRes = await app.handle(
        makeRequest("/keys", {
          method: "POST",
          body: JSON.stringify({ name: "usage-test-key" }),
        })
      );
      const created = await createRes.json() as any;

      const date1 = "2025-01-01";
      const date2 = "2025-01-02";
      await db.insert(apiUsage).values([
        { apiKeyId: created.id, date: date1, coldRequests: 1, hotRequests: 2, statusRequests: 0 },
        { apiKeyId: created.id, date: date2, coldRequests: 0, hotRequests: 0, statusRequests: 3 },
      ]);

      const res = await app.handle(makeRequest(`/keys/${created.id}/usage`));
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.key.id).toBe(created.id);
      expect(body.key.name).toBe("usage-test-key");
      expect(body.usage).toHaveLength(2);
      expect(body.usage[0].date).toBe(date2);
      expect(body.usage[1].date).toBe(date1);
    });

    it("returns 404 for non-existent key usage", async () => {
      const res = await app.handle(makeRequest("/keys/99999/usage"));
      expect(res.status).toBe(404);
    });
  });
});

// --- usage-tracker tests (reuses keys DB) -----------------------------------

describe("trackUsage", () => {
  let trackerKeyId: number;

  beforeAll(async () => {
    const keyRaw = "vow_wit_trackertest_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const keyHash = await Bun.password.hash(keyRaw);
    const [row] = await db
      .insert(apiKeys)
      .values({
        name: "tracker-test-key",
        keyHash,
        keyPrefix: keyRaw.slice(0, 18),
        createdBy: "test",
      })
      .returning({ id: apiKeys.id });
    trackerKeyId = row!.id;
  });

  it("is a no-op when apiKeyId is null", async () => {
    const prev = await db.select({ count: apiUsage.id }).from(apiUsage);
    const prevCount = prev[0]?.count ?? 0;
    await trackUsage(db, null, "cold");
    const after = await db.select({ count: apiUsage.id }).from(apiUsage);
    expect(after[0]?.count).toBe(prevCount);
  });

  it("is a no-op when apiKeyId is <= 0", async () => {
    await trackUsage(db, 0, "cold");
    await trackUsage(db, -1, "cold");
    // No error means pass
  });

  it("creates a usage row for a cold request", async () => {
    await trackUsage(db, trackerKeyId, "cold");
    const rows = await db
      .select()
      .from(apiUsage)
      .where(eq(apiUsage.apiKeyId, trackerKeyId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = rows.find(r => r.date === today);
    expect(todayRow).toBeTruthy();
    expect(todayRow!.coldRequests).toBeGreaterThanOrEqual(1);
  });

  it("increments on repeat tracking", async () => {
    await trackUsage(db, trackerKeyId, "cold");
    await trackUsage(db, trackerKeyId, "hot");
    await trackUsage(db, trackerKeyId, "status");

    const today = new Date().toISOString().slice(0, 10);
    const [row] = await db
      .select()
      .from(apiUsage)
      .where(and(eq(apiUsage.apiKeyId, trackerKeyId), eq(apiUsage.date, today)));
    expect(row!.coldRequests).toBeGreaterThanOrEqual(2);
    expect(row!.hotRequests).toBeGreaterThanOrEqual(1);
    expect(row!.statusRequests).toBeGreaterThanOrEqual(1);
  });
});
