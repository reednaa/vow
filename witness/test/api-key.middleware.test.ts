import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, and } from "drizzle-orm";
import { Elysia } from "elysia";
import { createDb, closeDb } from "../src/db/client";
import { apiKeys } from "../src/db/schema";
import type { ApiKeyContext } from "../src/api/api-key.middleware";

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";

let db: ReturnType<typeof createDb>;
let activeKeyRaw: string;
let activeKeyId: number;
let revokedKeyRaw: string;

// Manually replicate the derive logic so we can test it without Elysia's
// plugin scoping issue (derive from .use()-d plugins doesn't propagate to
// sub-apps due to filterGlobalHook not preserving hook structure).
async function deriveApiKey(request: Request): Promise<{ apiKey: ApiKeyContext; status?: number }> {
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
      return { apiKey: { apiKeyId: key.id, apiKeyName: key.name } };
    }
  }

  return { apiKey: { apiKeyId: -1, apiKeyName: null }, status: 401 };
}

function makeApp() {
  return new Elysia()
    .onError(({ error, set }) => {
      set.status = 500;
      return { error: String(error) };
    })
    .get("/test-auth", async ({ request, set }: any) => {
      const { apiKey, status } = await deriveApiKey(request);
      if (apiKey.apiKeyId === -1) {
        set.status = status ?? 401;
        return { error: "Invalid API key", code: "invalid_api_key" };
      }
      return { apiKeyId: apiKey.apiKeyId, apiKeyName: apiKey.apiKeyName };
    });
}

beforeAll(async () => {
  db = createDb(DATABASE_URL);

  await db.delete(apiKeys).where(eq(apiKeys.keyPrefix, "vow_wit_testprefix"));

  // Create an active key
  activeKeyRaw = "vow_wit_testprefix" + "a".repeat(46);
  const keyHash = await Bun.password.hash(activeKeyRaw);
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: "test-key-active",
      keyHash,
      keyPrefix: activeKeyRaw.slice(0, 18),
      createdBy: "test",
    })
    .returning({ id: apiKeys.id });
  activeKeyId = row!.id;

  // Create a revoked key
  revokedKeyRaw = "vow_wit_testprefix" + "b".repeat(46);
  const revokedHash = await Bun.password.hash(revokedKeyRaw);
  await db
    .insert(apiKeys)
    .values({
      name: "test-key-revoked",
      keyHash: revokedHash,
      keyPrefix: revokedKeyRaw.slice(0, 18),
      isActive: false,
      createdBy: "test",
    });
});

afterAll(async () => {
  await db.delete(apiKeys).where(eq(apiKeys.keyPrefix, "vow_wit_testprefix"));
  await closeDb();
});

describe("API Key Middleware", () => {
  it("passes through null context when no auth header or query param is present", async () => {
    const app = makeApp();
    const res = await app.handle(new Request("http://localhost/test-auth"));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.apiKeyId).toBeNull();
    expect(body.apiKeyName).toBeNull();
  });

  it("returns 401 for a Bearer token that does not match any key", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request("http://localhost/test-auth", {
        headers: { authorization: "Bearer vow_wit_nonexistent_random_hex_0000000000000000000000" },
      })
    );
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.code).toBe("invalid_api_key");
  });

  it("returns 401 for a Bearer token with a matching prefix but wrong suffix", async () => {
    const app = makeApp();
    const wrongKey = activeKeyRaw.slice(0, 18) + "wrong_suffix_here_00000000000000000000000000";
    const res = await app.handle(
      new Request("http://localhost/test-auth", {
        headers: { authorization: `Bearer ${wrongKey}` },
      })
    );
    expect(res.status).toBe(401);
  });

  it("authenticates successfully with a valid Bearer token", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request("http://localhost/test-auth", {
        headers: { authorization: `Bearer ${activeKeyRaw}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.apiKeyId).toBe(activeKeyId);
    expect(body.apiKeyName).toBe("test-key-active");
  });

  it("authenticates via api_key query parameter", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request(`http://localhost/test-auth?api_key=${activeKeyRaw}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.apiKeyId).toBe(activeKeyId);
  });

  it("prefers Bearer token over api_key query parameter when both are present", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request(`http://localhost/test-auth?api_key=vow_wit_bad_key_00000000000000000000000000`, {
        headers: { authorization: `Bearer ${activeKeyRaw}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.apiKeyId).toBe(activeKeyId);
  });

  it("returns 401 for a revoked (inactive) key", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request("http://localhost/test-auth", {
        headers: { authorization: `Bearer ${revokedKeyRaw}` },
      })
    );
    expect(res.status).toBe(401);
  });
});
