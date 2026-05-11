import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { apiKeys } from "../db/schema.ts";
import type { Db } from "../db/client.ts";

export interface ApiKeyContext {
  apiKeyId: number | null;
  apiKeyName: string | null;
}

export function createApiKeyDerive(db: Db) {
  return async ({ request, set }: { request: Request; set: { status: number } }): Promise<{ apiKey: ApiKeyContext }> => {
    let rawKey: string | null = null;

    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      rawKey = authHeader.slice(7);
    } else {
      try {
        const url = new URL(request.url);
        rawKey = url.searchParams.get("api_key");
      } catch {
        // url parse can fail
      }
    }

    if (!rawKey) {
      return { apiKey: { apiKeyId: null, apiKeyName: null } };
    }

    const keyPrefix = rawKey.slice(0, 18);

    const matched = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyPrefix, keyPrefix), eq(apiKeys.isActive, true)));

    for (const key of matched) {
      const valid = await Bun.password.verify(rawKey, key.keyHash);
      if (valid) {
        db.update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, key.id))
          .catch(() => {});

        return { apiKey: { apiKeyId: key.id, apiKeyName: key.name } };
      }
    }

    set.status = 401;
    return { apiKey: { apiKeyId: -1, apiKeyName: null } };
  };
}
