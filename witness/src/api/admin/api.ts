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
import { createApiKeyRoutes } from "./keys.ts";
import { getSolanaLatestSlots } from "../../db/queries.ts";

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
      const [chainCounts, rpcCounts, blockCounts, eventCounts, solanaSlotCounts, solanaEventCounts, jobStats] =
        await Promise.all([
          db.select({ count: count() }).from(chains),
          db.select({ count: count() }).from(rpcs),
          db.select({ count: count() }).from(indexedBlocks),
          db.select({ count: count() }).from(indexedEvents),
          db.select({ count: count() }).from(solanaIndexedSlots),
          db.select({ count: count() }).from(solanaIndexedEvents),
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
      const blockCount = (blockCounts[0]?.count ?? 0) + (solanaSlotCounts[0]?.count ?? 0);
      const eventCount = (eventCounts[0]?.count ?? 0) + (solanaEventCounts[0]?.count ?? 0);

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
          confirmations: chains.confirmations,
          updatedAt: chains.updatedAt,
          rpcCount: count(rpcs.id),
        })
        .from(chains)
        .leftJoin(rpcs, eq(rpcs.chainId, chains.chainId))
        .groupBy(chains.chainId, chains.latestBlock, chains.confirmations, chains.updatedAt)
        .orderBy(chains.chainId);

      const solanaChainIds = rows
        .filter((r) => r.chainId.startsWith("solana:"))
        .map((r) => r.chainId);

      const solanaLatest = await getSolanaLatestSlots(db, solanaChainIds);

      return rows.map((r: any) => ({
        ...r,
        latestBlock:
          solanaLatest.get(r.chainId)?.toString() ?? r.latestBlock?.toString() ?? null,
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
        await db.insert(chains).values({
          chainId,
          confirmations: body.confirmations ?? 12,
        });
        return { ok: true, chainId };
      },
      {
        body: t.Object({
          chainId: t.String({ pattern: "^(eip155:\\d+|solana:.+)$" }),
          confirmations: t.Optional(t.Numeric({ minimum: 0 })),
        }),
      }
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
      await db.transaction(async (tx) => {
        await tx.delete(solanaIndexedEvents).where(eq(solanaIndexedEvents.chainId, chainId));
        await tx.delete(solanaIndexedSlots).where(eq(solanaIndexedSlots.chainId, chainId));
        await tx.delete(indexedEvents).where(eq(indexedEvents.chainId, chainId));
        await tx.delete(indexedBlocks).where(eq(indexedBlocks.chainId, chainId));
        await tx.delete(rpcs).where(eq(rpcs.chainId, chainId));
        await tx.delete(chains).where(eq(chains.chainId, chainId));
      });
      return { ok: true };
    })
    .patch(
      "/chains/:chainId",
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
        await db
          .update(chains)
          .set({ confirmations: body.confirmations })
          .where(eq(chains.chainId, chainId));
        return { ok: true, chainId, confirmations: body.confirmations };
      },
      { body: t.Object({ confirmations: t.Numeric({ minimum: 0 }) }) }
    )

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
    .post("/jobs/:id/requeue", async ({ params, set }) => {
      const id = BigInt(params.id);
      const updated = await db
        .update(graphileWorkerPrivateJobs)
        .set({ lockedAt: null, attempts: 0 })
        .where(eq(graphileWorkerPrivateJobs.id, id))
        .returning({ id: graphileWorkerPrivateJobs.id });
      if (updated.length === 0) {
        set.status = 404;
        return { error: "Job not found" };
      }
      return { ok: true };
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

      const isSolana = chainId.startsWith("solana:");

      if (isSolana) {
        const slots = await db
          .select({
            blockNumber: solanaIndexedSlots.slot,
            blockHash: solanaIndexedSlots.blockhash,
            merkleRoot: solanaIndexedSlots.merkleRoot,
            latestBlockAtIndex: solanaIndexedSlots.latestSlotAtIndex,
            createdAt: solanaIndexedSlots.createdAt,
          })
          .from(solanaIndexedSlots)
          .where(eq(solanaIndexedSlots.chainId, chainId))
          .orderBy(desc(solanaIndexedSlots.slot))
          .limit(50);

        return slots.map((s: any) => ({
          ...s,
          blockNumber: s.blockNumber.toString(),
          latestBlockAtIndex: s.latestBlockAtIndex.toString(),
        }));
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
    })

    // ── API Keys ─────────────────────────────────────────────────────────────
    .use(createApiKeyRoutes(db));
}
