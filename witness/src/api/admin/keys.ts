import { Elysia, t } from "elysia";
import { eq, and, desc, sql, count, sum } from "drizzle-orm";
import { apiKeys, apiUsage } from "../../db/schema.ts";
import type { Db } from "../../db/client.ts";

function generateApiKey(): { rawKey: string; keyPrefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const rawKey = `vow_wit_${hex}`;
  const keyPrefix = rawKey.slice(0, 18);
  return { rawKey, keyPrefix };
}

export function createApiKeyRoutes(db: Db) {
  return new Elysia({ prefix: "/keys" })

    .post(
      "/",
      async ({ body, set }) => {
        const { rawKey, keyPrefix } = generateApiKey();
        const keyHash = await Bun.password.hash(rawKey);

        const [row] = await db
          .insert(apiKeys)
          .values({
            name: body.name,
            keyHash,
            keyPrefix,
            createdBy: "admin",
          })
          .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });

        if (!row) {
          set.status = 500;
          return { error: "Failed to create API key" };
        }

        return {
          id: row.id,
          name: body.name,
          key: rawKey,
          keyPrefix,
          createdAt: row.createdAt,
        };
      },
      {
        body: t.Object({ name: t.String({ minLength: 1 }) }),
      },
    )

    .get("/", async () => {
      const today = new Date().toISOString().slice(0, 10);

      const keys = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          isActive: apiKeys.isActive,
          createdBy: apiKeys.createdBy,
          createdAt: apiKeys.createdAt,
          lastUsedAt: apiKeys.lastUsedAt,
        })
        .from(apiKeys)
        .orderBy(desc(apiKeys.createdAt));

      const todayUsageRows = await db
        .select({
          apiKeyId: apiUsage.apiKeyId,
          cold: apiUsage.coldRequests,
          hot: apiUsage.hotRequests,
          status: apiUsage.statusRequests,
        })
        .from(apiUsage)
        .where(eq(apiUsage.date, today));

      const usageByKey = new Map(
        todayUsageRows.map((u) => [u.apiKeyId, u]),
      );

      return keys.map((key) => {
        const u = usageByKey.get(key.id);
        return {
          ...key,
          todayUsage: {
            cold: u?.cold ?? 0,
            hot: u?.hot ?? 0,
            status: u?.status ?? 0,
          },
        };
      });
    })

    .post("/:id/revoke", async ({ params, set }) => {
      const id = parseInt(params.id, 10);
      const [key] = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(eq(apiKeys.id, id));

      if (!key) {
        set.status = 404;
        return { error: "API key not found" };
      }

      await db
        .update(apiKeys)
        .set({ isActive: false })
        .where(eq(apiKeys.id, id));

      return { ok: true };
    })

    .get("/:id/usage", async ({ params, set }) => {
      const id = parseInt(params.id, 10);
      const [key] = await db
        .select({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, isActive: apiKeys.isActive })
        .from(apiKeys)
        .where(eq(apiKeys.id, id));

      if (!key) {
        set.status = 404;
        return { error: "API key not found" };
      }

      const rows = await db
        .select()
        .from(apiUsage)
        .where(eq(apiUsage.apiKeyId, id))
        .orderBy(desc(apiUsage.date))
        .limit(30);

      return {
        key: { id: key.id, name: key.name, keyPrefix: key.keyPrefix, isActive: key.isActive },
        usage: rows.map((r) => ({
          date: r.date,
          coldRequests: r.coldRequests,
          hotRequests: r.hotRequests,
          statusRequests: r.statusRequests,
        })),
      };
    });
}
