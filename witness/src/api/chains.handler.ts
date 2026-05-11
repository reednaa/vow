import { Elysia } from "elysia";
import { eq, count } from "drizzle-orm";
import { chains, rpcs } from "../db/schema.ts";
import { normalizeChainId } from "../core/chain-utils.ts";
import { getSolanaLatestSlots, getSolanaLatestSlot } from "../db/queries.ts";
import type { Db } from "../db/client.ts";

export function createChainsController(db: Db) {
  return new Elysia()
    .get(
      "/chains",
      async () => {
        const rows = await db
          .select({
            chainId: chains.chainId,
            latestBlock: chains.latestBlock,
            confirmations: chains.confirmations,
            rpcCount: count(rpcs.id),
          })
          .from(chains)
          .leftJoin(rpcs, eq(rpcs.chainId, chains.chainId))
          .groupBy(chains.chainId, chains.latestBlock, chains.confirmations)
          .orderBy(chains.chainId);

        const solanaChainIds = rows
          .filter((r) => r.chainId.startsWith("solana:"))
          .map((r) => r.chainId);

        const solanaLatest = await getSolanaLatestSlots(db, solanaChainIds);

        return rows.map((r: any) => ({
          chainId: r.chainId,
          latestBlock:
            solanaLatest.get(r.chainId)?.toString() ?? r.latestBlock?.toString() ?? null,
          confirmations: r.confirmations,
          rpcCount: Number(r.rpcCount),
        }));
      },
      {
        detail: {
          tags: ["Chains"],
          summary: "List all supported chains",
          description: "Returns all configured chains with their latest indexed block/slot, required confirmations, and RPC count.",
        },
      },
    )
    .get(
      "/chains/:chainId",
      async ({ params, set }) => {
        let chainId: string;
        try {
          chainId = normalizeChainId(params.chainId);
        } catch {
          set.status = 400;
          return { error: "Invalid chain ID" } as const;
        }

        const [chain] = await db
          .select({
            chainId: chains.chainId,
            latestBlock: chains.latestBlock,
            confirmations: chains.confirmations,
          })
          .from(chains)
          .where(eq(chains.chainId, chainId));

        if (!chain) {
          set.status = 404;
          return { error: "Chain not found" } as const;
        }

        let latestBlock = chain.latestBlock?.toString() ?? null;

        if (chainId.startsWith("solana:")) {
          const slot = await getSolanaLatestSlot(db, chainId);
          if (slot != null) {
            latestBlock = slot.toString();
          }
        }

        return {
          chainId: chain.chainId,
          latestBlock,
          confirmations: chain.confirmations,
        };
      },
      {
        detail: {
          tags: ["Chains"],
          summary: "Get chain details",
          description: "Returns the latest indexed block/slot and confirmation count for a specific CAIP-2 chain ID.",
        },
      },
    );
}

type ChainsController = ReturnType<typeof createChainsController>;
type AppWithUse = { use: (plugin: ChainsController) => unknown };

export function mountChainsHandler<TApp extends AppWithUse>(app: TApp, db: Db) {
  app.use(createChainsController(db));
  return app;
}
