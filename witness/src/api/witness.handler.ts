import { Elysia } from "elysia";
import { eq, and, sql } from "drizzle-orm";
import { type Hex } from "viem";
import { chains, indexedBlocks, indexedEvents } from "../db/schema.ts";
import { buildMerkleTree, generateProof } from "../core/merkle.ts";
import { decodeEvent } from "../core/encoding.ts";
import { INDEX_BLOCK_TASK } from "../worker/index-block.task.ts";
import { witnessParams, witnessResponse } from "./model.ts";

export type AddJobFn = (identifier: string, payload?: any, spec?: any) => Promise<any>;

const CAIP2_RE = /^eip155:(\d+)$/;

export function createWitnessController(db: any, addJob: AddJobFn) {
  return new Elysia().get(
    "/witness/:caip2ChainId/:blockNumber/:logIndex",
    async ({ params, set }) => {
      const { caip2ChainId, blockNumber, logIndex } = params;
      const chainId = parseInt(CAIP2_RE.exec(caip2ChainId)![1]!, 10);
      const blockNumberBigInt = BigInt(blockNumber);

      // Check chain exists
      const [chain] = await db
        .select()
        .from(chains)
        .where(eq(chains.chainId, chainId));

      if (!chain) {
        set.status = 404;
        return { error: "Chain not configured" };
      }

      // Check if block is indexed
      const [block] = await db
        .select()
        .from(indexedBlocks)
        .where(
          and(
            eq(indexedBlocks.chainId, chainId),
            eq(indexedBlocks.blockNumber, blockNumberBigInt)
          )
        );

      if (block) {
        // Block is indexed — check if event exists
        const [event] = await db
          .select()
          .from(indexedEvents)
          .where(
            and(
              eq(indexedEvents.chainId, chainId),
              eq(indexedEvents.blockNumber, blockNumberBigInt),
              eq(indexedEvents.logIndex, logIndex)
            )
          );

        if (!event) {
          set.status = 404;
          return { error: "Event not found at this logIndex" };
        }

        // Load all events for this block to reconstruct Merkle tree
        const allEvents = await db
          .select()
          .from(indexedEvents)
          .where(
            and(
              eq(indexedEvents.chainId, chainId),
              eq(indexedEvents.blockNumber, blockNumberBigInt)
            )
          );

        // Reconstruct tree
        const sortedEvents = [...allEvents].sort(
          (a: any, b: any) => a.treeIndex - b.treeIndex
        );
        const leafHashes = sortedEvents.map((e: any) => e.leafHash as Hex);
        const { root, tree } = buildMerkleTree(leafHashes);
        const proof = generateProof(tree, event.treeIndex);

        // Decode canonical bytes
        const canonicalBytes = Buffer.from(event.canonicalBytes, "hex");
        const { emitter, topics, data } = decodeEvent(new Uint8Array(canonicalBytes));

        return {
          status: "ready" as const,
          witness: {
            chainId,
            latestBlockNumber: Number(block.latestBlockAtIndex),
            rootBlockNumber: blockNumber,
            root: block.merkleRoot,
            blockHash: block.blockHash,
            proof,
            signature: block.signature,
            event: { emitter, topics, data },
          },
        };
      }

      // Block not indexed — check for existing Graphile job
      const jobKey = `index:${chainId}:${blockNumber}`;
      const jobRows = await db.execute(
        sql`SELECT id, locked_at, attempts, max_attempts FROM graphile_worker.jobs WHERE key = ${jobKey} LIMIT 1`
      );
      const job = jobRows.rows?.[0] ?? jobRows[0] ?? null;

      if (job) {
        if (job.locked_at) {
          return { status: "indexing" as const };
        }
        if (job.attempts >= job.max_attempts) {
          return { status: "failed" as const, error: "Block indexing failed after max retries" };
        }
        return { status: "pending" as const };
      }

      // No job — enqueue one
      await addJob(INDEX_BLOCK_TASK, { chainId, blockNumber }, { jobKey, maxAttempts: 5 });

      return { status: "pending" as const };
    },
    { params: witnessParams, response: witnessResponse }
  );
}

type WitnessController = ReturnType<typeof createWitnessController>;
type AppWithUse = { use: (plugin: WitnessController) => unknown };

export function mountWitnessHandler<TApp extends AppWithUse>(app: TApp, db: any, addJob: AddJobFn) {
  app.use(createWitnessController(db, addJob));
  return app;
}
