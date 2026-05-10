import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { eq, count, desc, sql } from "drizzle-orm";
import { createPublicClient, http } from "viem";
import { chains, rpcs, indexedBlocks, indexedEvents } from "../../db/schema.ts";

async function validateRpc(
  url: string
): Promise<{ ok: boolean; blockNumber?: string; error?: string }> {
  try {
    const client = createPublicClient({ transport: http(url, { timeout: 5_000 }) });
    const blockNumber = await client.getBlockNumber();
    return { ok: true, blockNumber: blockNumber.toString() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function createAdminApiPlugin(db: any, jwtSecret: string) {
  return new Elysia({ prefix: "/admin/api" })
    .use(jwt({ name: "jwt", secret: jwtSecret }))
    .onBeforeHandle(async ({ jwt, cookie: { adminToken }, set, path }: any) => {
      const payload = await jwt.verify(adminToken?.value);
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
    })

    // ── Auth check ────────────────────────────────────────────────────────────
    .get("/me", () => ({ ok: true }))

    // ── Stats ─────────────────────────────────────────────────────────────────
    .get("/stats", async () => {
      const [[chainCount], [rpcCount], [blockCount], [eventCount], jobStats] =
        await Promise.all([
          db.select({ count: count() }).from(chains),
          db.select({ count: count() }).from(rpcs),
          db.select({ count: count() }).from(indexedBlocks),
          db.select({ count: count() }).from(indexedEvents),
          db
            .execute(
              sql`SELECT
                COUNT(*) FILTER (WHERE locked_at IS NULL AND attempts < max_attempts) AS pending,
                COUNT(*) FILTER (WHERE locked_at IS NOT NULL) AS running,
                COUNT(*) FILTER (WHERE attempts >= max_attempts) AS failed
              FROM graphile_worker.jobs`
            )
            .catch(() => [{ pending: 0, running: 0, failed: 0 }]),
        ]);

      const jr = jobStats.rows?.[0] ?? jobStats[0] ?? {};
      return {
        chains: Number(chainCount.count),
        rpcs: Number(rpcCount.count),
        indexedBlocks: Number(blockCount.count),
        indexedEvents: Number(eventCount.count),
        jobs: {
          pending: Number(jr.pending ?? 0),
          running: Number(jr.running ?? 0),
          failed: Number(jr.failed ?? 0),
        },
      };
    })

    // ── Chains ────────────────────────────────────────────────────────────────
    .get("/chains", async () => {
      const rows = await db
        .select({
          chainId: chains.chainId,
          latestBlock: chains.latestBlock,
          updatedAt: chains.updatedAt,
          rpcCount: count(rpcs.id),
        })
        .from(chains)
        .leftJoin(rpcs, eq(rpcs.chainId, chains.chainId))
        .groupBy(chains.chainId, chains.latestBlock, chains.updatedAt)
        .orderBy(chains.chainId);

      return rows.map((r: any) => ({
        ...r,
        latestBlock: r.latestBlock?.toString() ?? null,
      }));
    })
    .post(
      "/chains",
      async ({ body, set }) => {
        const { chainId } = body;
        // Validate CAIP-2 format
        if (!/^(eip155:\d+|solana:.+)$/.test(chainId)) {
          set.status = 400;
          return { error: `chainId must be a valid CAIP-2 string (e.g., "eip155:1" or "solana:mainnet")` };
        }
        const [existing] = await db
          .select()
          .from(chains)
          .where(eq(chains.chainId, chainId));
        if (existing) {
          set.status = 409;
          return { error: `Chain ${chainId} already configured` };
        }
        await db.insert(chains).values({ chainId });
        return { ok: true, chainId };
      },
      { body: t.Object({ chainId: t.String({ pattern: "^(eip155:\\d+|solana:.+)$" }) }) }
    )
    .delete("/chains/:chainId", async ({ params, set }) => {
      const chainId = params.chainId;
      const [existing] = await db
        .select()
        .from(chains)
        .where(eq(chains.chainId, chainId));
      if (!existing) {
        set.status = 404;
        return { error: "Chain not found" };
      }
      // Delete dependents in FK order
      await db.delete(indexedEvents).where(eq(indexedEvents.chainId, chainId));
      await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, chainId));
      await db.delete(rpcs).where(eq(rpcs.chainId, chainId));
      await db.delete(chains).where(eq(chains.chainId, chainId));
      return { ok: true };
    })

    // ── RPCs ──────────────────────────────────────────────────────────────────
    .get("/chains/:chainId/rpcs", async ({ params, set }) => {
      const chainId = params.chainId;
      const [chain] = await db
        .select()
        .from(chains)
        .where(eq(chains.chainId, chainId));
      if (!chain) {
        set.status = 404;
        return { error: "Chain not found" };
      }
      return db.select().from(rpcs).where(eq(rpcs.chainId, chainId));
    })
    .post(
      "/chains/:chainId/rpcs",
      async ({ params, body, set }) => {
        const chainId = params.chainId;
        const [chain] = await db
          .select()
          .from(chains)
          .where(eq(chains.chainId, chainId));
        if (!chain) {
          set.status = 404;
          return { error: "Chain not found" };
        }
        const validation = await validateRpc(body.url);
        if (!validation.ok) {
          set.status = 400;
          return { error: `RPC validation failed: ${validation.error}` };
        }
        const [row] = await db
          .insert(rpcs)
          .values({ chainId, url: body.url })
          .returning();
        return { ok: true, id: row.id, blockNumber: validation.blockNumber };
      },
      { body: t.Object({ url: t.String({ minLength: 1 }) }) }
    )
    .delete("/rpcs/:id", async ({ params, set }) => {
      const id = parseInt(params.id, 10);
      const [existing] = await db.select().from(rpcs).where(eq(rpcs.id, id));
      if (!existing) {
        set.status = 404;
        return { error: "RPC not found" };
      }
      await db.delete(rpcs).where(eq(rpcs.id, id));
      return { ok: true };
    })

    // ── Jobs ──────────────────────────────────────────────────────────────────
    .get("/jobs", async () => {
      const result = await db
        .execute(
          sql`SELECT
            id, key, task_identifier, payload,
            attempts, max_attempts, last_error,
            locked_at, run_at, created_at,
            CASE
              WHEN locked_at IS NOT NULL THEN 'running'
              WHEN attempts >= max_attempts THEN 'failed'
              WHEN run_at > NOW() THEN 'scheduled'
              ELSE 'pending'
            END AS status
          FROM graphile_worker.jobs
          ORDER BY created_at DESC
          LIMIT 100`
        )
        .catch(() => ({ rows: [] }));

      return (result.rows ?? result).map((j: any) => ({
        id: String(j.id),
        key: j.key,
        task: j.task_identifier,
        payload: j.payload,
        attempts: j.attempts,
        maxAttempts: j.max_attempts,
        lastError: j.last_error,
        lockedAt: j.locked_at,
        runAt: j.run_at,
        createdAt: j.created_at,
        status: j.status,
      }));
    })

    // ── Indexed blocks per chain ──────────────────────────────────────────────
    .get("/chains/:chainId/blocks", async ({ params, set }) => {
      const chainId = params.chainId;
      const [chain] = await db
        .select()
        .from(chains)
        .where(eq(chains.chainId, chainId));
      if (!chain) {
        set.status = 404;
        return { error: "Chain not found" };
      }
      const blocks = await db
        .select({
          blockNumber: indexedBlocks.blockNumber,
          blockHash: indexedBlocks.blockHash,
          merkleRoot: indexedBlocks.merkleRoot,
          latestBlockAtIndex: indexedBlocks.latestBlockAtIndex,
          createdAt: indexedBlocks.createdAt,
        })
        .from(indexedBlocks)
        .where(eq(indexedBlocks.chainId, chainId))
        .orderBy(desc(indexedBlocks.blockNumber))
        .limit(50);

      return blocks.map((b: any) => ({
        ...b,
        blockNumber: b.blockNumber.toString(),
        latestBlockAtIndex: b.latestBlockAtIndex.toString(),
      }));
    });
}
