import { type Task } from "graphile-worker";
import { eq, sql } from "drizzle-orm";
import { type Hex } from "viem";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { createRpcClient, type RpcClient } from "../rpc/client.ts";
import { instrumentRpcClient } from "../rpc/instrumented-client.ts";
import { fetchBlockConsistent, type ConsistentBlockResult } from "../rpc/consistency.ts";
import { buildMerkleTree, ZERO_HASH } from "../core/merkle.ts";
import { chains, rpcs, indexedBlocks, indexedEvents } from "../db/schema.ts";
import type { Signer } from "../core/signer.interface.ts";
import type { createDb } from "../db/client.ts";

export const INDEX_BLOCK_TASK = "index-block" as const;

export type IndexBlockPayload = {
  chainId: number;
  blockNumber: number;
};

type Db = ReturnType<typeof createDb>;
type FetchBlockFn = (
  rpcs: RpcClient[],
  blockNumber: bigint
) => Promise<ConsistentBlockResult>;

export function createIndexBlockTask(
  db: Db,
  signer: Signer,
  fetchBlock?: FetchBlockFn
): Task {
  return async (payload) => {
    const { chainId, blockNumber } = payload as IndexBlockPayload;
    const blockNumberBigInt = BigInt(blockNumber);

    const tracer = trace.getTracer("vow-witness");
    await tracer.startActiveSpan(
      "index-block",
      { attributes: { "chain.id": chainId, "block.number": blockNumber } },
      async (span) => {
        try {
          // Fetch RPC URLs for this chain
          const rpcRows = await db
            .select({ url: rpcs.url })
            .from(rpcs)
            .where(eq(rpcs.chainId, chainId));

          if (rpcRows.length < 2) {
            throw new Error(
              `Chain ${chainId} has only ${rpcRows.length} RPC(s). At least 2 required.`
            );
          }

          const parentContext = trace.setSpan(context.active(), span);
          const rpcClients = rpcRows.map((row) =>
            instrumentRpcClient(createRpcClient(row.url), { url: row.url, chainId }, parentContext)
          );

          // Fetch and validate block data from all RPCs
          const fetcher = fetchBlock ?? fetchBlockConsistent;
          const consistent = await fetcher(rpcClients, blockNumberBigInt);

          // Handle empty block
          if (consistent.events.length === 0) {
            const sig = await signer.signVow({
              chainId: BigInt(chainId),
              rootBlockNumber: blockNumberBigInt,
              root: ZERO_HASH,
            });

            await db.transaction(async (tx) => {
              await tx
                .insert(indexedBlocks)
                .values({
                  chainId,
                  blockNumber: blockNumberBigInt,
                  blockHash: consistent.blockHash,
                  merkleRoot: ZERO_HASH,
                  latestBlockAtIndex: consistent.latestBlock,
                  signature: sig,
                })
                .onConflictDoNothing();

              await tx
                .update(chains)
                .set({
                  latestBlock: sql`greatest(${chains.latestBlock}, ${consistent.latestBlock})`,
                  updatedAt: sql`now()`,
                })
                .where(eq(chains.chainId, chainId));
            });

            return;
          }

          // Build Merkle tree from leaf hashes
          const leafHashes = consistent.events.map((e) => e.leafHash as Hex);
          const { root: merkleRoot, tree } = buildMerkleTree(leafHashes);

          // Determine tree index (position in sorted leaf array = tree[0])
          const sortedLeaves = tree[0]!;
          const treeIndexMap = new Map<string, number>();
          for (let i = 0; i < sortedLeaves.length; i++) {
            treeIndexMap.set(sortedLeaves[i]!.toLowerCase(), i);
          }

          // Sign the Vow struct
          const sig = await signer.signVow({
            chainId: BigInt(chainId),
            rootBlockNumber: blockNumberBigInt,
            root: merkleRoot,
          });

          // Write everything in a single transaction
          await db.transaction(async (tx) => {
            await tx
              .insert(indexedBlocks)
              .values({
                chainId,
                blockNumber: blockNumberBigInt,
                blockHash: consistent.blockHash,
                merkleRoot,
                latestBlockAtIndex: consistent.latestBlock,
                signature: sig,
              })
              .onConflictDoNothing();

            for (const event of consistent.events) {
              const treeIndex = treeIndexMap.get(event.leafHash.toLowerCase()) ?? 0;
              await tx
                .insert(indexedEvents)
                .values({
                  chainId,
                  blockNumber: blockNumberBigInt,
                  logIndex: event.logIndex,
                  leafHash: event.leafHash,
                  canonicalBytes: Buffer.from(event.canonicalBytes).toString("hex"),
                  treeIndex,
                })
                .onConflictDoNothing();
            }

            await tx
              .update(chains)
              .set({
                latestBlock: sql`greatest(${chains.latestBlock}, ${consistent.latestBlock})`,
                updatedAt: sql`now()`,
              })
              .where(eq(chains.chainId, chainId));
          });
        } catch (err: any) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      }
    );
  };
}
