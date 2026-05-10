import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { eq, count, desc, sql } from "drizzle-orm";
import { createPublicClient, http } from "viem";
import {
  chains,
  rpcs,
  indexedBlocks,
  indexedEvents,
  solanaIndexedEvents,
  solanaIndexedSlots,
} from "../../db/schema.ts";
import {
  graphileWorkerPrivateJobs,
  graphileWorkerPrivateTasks,
} from "../../db/graphile-worker.ts";
import type { Db } from "../../db/client.ts";
import { normalizeChainId } from "../../core/chain-utils.ts";
import { createSolanaRpcClient } from "../../rpc/solana-client.ts";

async function validateRpc(
  url: string,
  chainId: string,
): Promise<{ ok: boolean; blockNumber?: string; error?: string }> {
  try {
    if (chainId.startsWith("solana:")) {
      const slot = await createSolanaRpcClient(url).getSlot();
      return { ok: true, blockNumber: slot.toString() };
    }

    const client = createPublicClient({ transport: http(url, { timeout: 5_000 }) });
    const blockNumber = await client.getBlockNumber();
    return { ok: true, blockNumber: blockNumber.toString() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function createAdminApiPlugin(db: Db, jwtSecret: string) {
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
      const [chainCounts, rpcCounts, blockCounts, eventCounts, jobStats] =
        await Promise.all([
          db.select({ count: count() }).from(chains),
          db.select({ count: count() }).from(rpcs),
          db.select({ count: count() }).from(indexedBlocks),
          db.select({ count: count() }).from(indexedEvents),
          db
            .select({
              pending: sql<number>`count(*) filter (
                where ${graphileWorkerPrivateJobs.lockedAt} is null
                  and ${graphileWorkerPrivateJobs.attempts} < ${graphileWorkerPrivateJobs.maxAttempts}
              )`,
              running: sql<number>`count(*) filter (where ${graphileWorkerPrivateJobs.lockedAt} is not null)`,
              failed: sql<number>`count(*) filter (
                where ${graphileWorkerPrivateJobs.attempts} >= ${graphileWorkerPrivateJobs.maxAttempts}
              )`,
            })
            .from(graphileWorkerPrivateJobs)
            .then(([row]) => row ?? { pending: 0, running: 0, failed: 0 })
            .catch(() => ({ pending: 0, running: 0, failed: 0 })),
        ]);

      const chainCount = chainCounts[0]?.count ?? 0;
      const rpcCount = rpcCounts[0]?.count ?? 0;
      const blockCount = blockCounts[0]?.count ?? 0;
      const eventCount = eventCounts[0]?.count ?? 0;

      return {
        chains: Number(chainCount),
        rpcs: Number(rpcCount),
        indexedBlocks: Number(blockCount),
        indexedEvents: Number(eventCount),
        jobs: {
          pending: Number(jobStats.pending ?? 0),
          running: Number(jobStats.running ?? 0),
          failed: Number(jobStats.failed ?? 0),
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
        let chainId: string;
        try {
          chainId = normalizeChainId(body.chainId);
        } catch {
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
      let chainId: string;
      try {
        chainId = normalizeChainId(params.chainId);
      } catch {
        set.status = 400;
        return { error: "Invalid chain ID" };
      }
      const [existing] = await db
        .select()
        .from(chains)
        .where(eq(chains.chainId, chainId));
      if (!existing) {
        set.status = 404;
        return { error: "Chain not found" };
      }
      // Delete dependents in FK order
      await db.delete(solanaIndexedEvents).where(eq(solanaIndexedEvents.chainId, chainId));
      await db.delete(solanaIndexedSlots).where(eq(solanaIndexedSlots.chainId, chainId));
      await db.delete(indexedEvents).where(eq(indexedEvents.chainId, chainId));
      await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, chainId));
      await db.delete(rpcs).where(eq(rpcs.chainId, chainId));
      await db.delete(chains).where(eq(chains.chainId, chainId));
      return { ok: true };
    })

    // ── RPCs ──────────────────────────────────────────────────────────────────
    .get("/chains/:chainId/rpcs", async ({ params, set }) => {
      let chainId: string;
      try {
        chainId = normalizeChainId(params.chainId);
      } catch {
        set.status = 400;
        return { error: "Invalid chain ID" };
      }
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
        let chainId: string;
        try {
          chainId = normalizeChainId(params.chainId);
        } catch {
          set.status = 400;
          return { error: "Invalid chain ID" };
        }
        const [chain] = await db
          .select()
          .from(chains)
          .where(eq(chains.chainId, chainId));
        if (!chain) {
          set.status = 404;
          return { error: "Chain not found" };
        }
        const validation = await validateRpc(body.url, chainId);
        if (!validation.ok) {
          set.status = 400;
          return { error: `RPC validation failed: ${validation.error}` };
        }
        const [row] = await db
          .insert(rpcs)
          .values({ chainId, url: body.url })
          .returning();
        if (!row) {
          throw new Error("RPC insert did not return a row");
        }
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
      const jobs = await db
        .select({
          id: graphileWorkerPrivateJobs.id,
          key: graphileWorkerPrivateJobs.key,
          task: graphileWorkerPrivateTasks.identifier,
          payload: graphileWorkerPrivateJobs.payload,
          attempts: graphileWorkerPrivateJobs.attempts,
          maxAttempts: graphileWorkerPrivateJobs.maxAttempts,
          lastError: graphileWorkerPrivateJobs.lastError,
          lockedAt: graphileWorkerPrivateJobs.lockedAt,
          runAt: graphileWorkerPrivateJobs.runAt,
          createdAt: graphileWorkerPrivateJobs.createdAt,
          status: sql<"running" | "failed" | "scheduled" | "pending">`case
            when ${graphileWorkerPrivateJobs.lockedAt} is not null then 'running'
            when ${graphileWorkerPrivateJobs.attempts} >= ${graphileWorkerPrivateJobs.maxAttempts} then 'failed'
            when ${graphileWorkerPrivateJobs.runAt} > now() then 'scheduled'
            else 'pending'
          end`,
        })
        .from(graphileWorkerPrivateJobs)
        .innerJoin(
          graphileWorkerPrivateTasks,
          eq(graphileWorkerPrivateTasks.id, graphileWorkerPrivateJobs.taskId),
        )
        .orderBy(desc(graphileWorkerPrivateJobs.createdAt))
        .limit(100)
        .catch(() => []);

      return jobs.map((job) => ({
        ...job,
        id: String(job.id),
      }));
    })

    // ── Indexed blocks per chain ──────────────────────────────────────────────
    .get("/chains/:chainId/blocks", async ({ params, set }) => {
      let chainId: string;
      try {
        chainId = normalizeChainId(params.chainId);
      } catch {
        set.status = 400;
        return { error: "Invalid chain ID" };
      }
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
