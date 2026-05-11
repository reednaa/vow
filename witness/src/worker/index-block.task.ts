import { type Task } from "graphile-worker";
import { eq, sql } from "drizzle-orm";
import { caip2ToNumericChainId } from "../core/chain-utils.ts";
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
  chainId: string;
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
  return async (payload, helpers) => {
    const { chainId, blockNumber } = payload as IndexBlockPayload;
    const blockNumberBigInt = BigInt(blockNumber);

    const startTime = Date.now();
    const elapsed = () => `+${Date.now() - startTime}ms`;

    console.log(`[index-block] start chainId=${chainId} blockNumber=${blockNumber}`);

    const tracer = trace.getTracer("vow-witness");
    await tracer.startActiveSpan(
      "index-block",
      { attributes: { "chain.id": chainId, "block.number": blockNumber } },
      async (span) => {
        try {
          // Fetch RPC URLs for this chain
          console.log(`[index-block] ${elapsed()} fetching RPC URLs for chainId=${chainId}`);
          const rpcRows = await db
            .select({ url: rpcs.url })
            .from(rpcs)
            .where(eq(rpcs.chainId, chainId));

          console.log(`[index-block] ${elapsed()} found ${rpcRows.length} RPC(s) for chainId=${chainId}`);

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
          console.log(`[index-block] ${elapsed()} fetching block ${blockNumber} from ${rpcClients.length} RPC(s)`);
          const fetcher = fetchBlock ?? fetchBlockConsistent;
          const consistent = await fetcher(rpcClients, blockNumberBigInt);

          console.log(
            `[index-block] ${elapsed()} block fetched blockHash=${consistent.blockHash} events=${consistent.events.length} latestBlock=${consistent.latestBlock}`
          );

          // Finality check: block must have enough confirmations before signing.
          // If not, re-enqueue with a delay instead of throwing — avoids maxAttempts
          // exhaustion and wastes no RPC calls on immediate retries.
          const [chainRow] = await db
            .select({ confirmations: chains.confirmations })
            .from(chains)
            .where(eq(chains.chainId, chainId));

          const requiredConfirmations = chainRow?.confirmations ?? 12;

          if (consistent.latestBlock < blockNumberBigInt) {
            console.log(
              `[index-block] ${elapsed()} block ${blockNumber} ahead of tip ${consistent.latestBlock} — re-enqueuing in 30s`
            );
            await helpers.addJob(
              INDEX_BLOCK_TASK,
              { chainId, blockNumber },
              { runAt: new Date(Date.now() + 30_000) },
            );
            return;
          }

          const confirmationsAchieved = consistent.latestBlock - blockNumberBigInt;

          if (confirmationsAchieved < requiredConfirmations) {
            const remaining = requiredConfirmations - Number(confirmationsAchieved);
            const delayMs = Math.min(remaining * 5_000, 120_000);
            console.log(
              `[index-block] ${elapsed()} block ${blockNumber} has ${confirmationsAchieved}/${requiredConfirmations} confirmations — re-enqueuing in ${delayMs}ms`
            );
            await helpers.addJob(
              INDEX_BLOCK_TASK,
              { chainId, blockNumber },
              { runAt: new Date(Date.now() + delayMs) },
            );
            return;
          }

          // Handle empty block
          if (consistent.events.length === 0) {
            console.log(`[index-block] ${elapsed()} empty block, signing zero-root vow`);
            const sig = await signer.signVow({
              chainId: caip2ToNumericChainId(chainId),
              rootBlockNumber: blockNumberBigInt,
              root: ZERO_HASH,
            });

            console.log(`[index-block] ${elapsed()} persisting empty block chainId=${chainId} blockNumber=${blockNumber}`);
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

            console.log(`[index-block] ${elapsed()} done (empty) chainId=${chainId} blockNumber=${blockNumber}`);
            return;
          }

          // Build Merkle tree from leaf hashes
          console.log(`[index-block] ${elapsed()} building merkle tree from ${consistent.events.length} leaf(ves)`);
          const leafHashes = consistent.events.map((e) => e.leafHash as Hex);
          const { root: merkleRoot, tree } = buildMerkleTree(leafHashes);
          console.log(`[index-block] ${elapsed()} merkle root=${merkleRoot}`);

          // Determine tree index (position in sorted leaf array = tree[0])
          const sortedLeaves = tree[0]!;
          const treeIndexMap = new Map<string, number>();
          for (let i = 0; i < sortedLeaves.length; i++) {
            treeIndexMap.set(sortedLeaves[i]!.toLowerCase(), i);
          }

          // Sign the Vow struct
          console.log(`[index-block] ${elapsed()} signing vow chainId=${chainId} blockNumber=${blockNumber} root=${merkleRoot}`);
          const sig = await signer.signVow({
            chainId: caip2ToNumericChainId(chainId),
            rootBlockNumber: blockNumberBigInt,
            root: merkleRoot,
          });

          // Write everything in a single transaction
          console.log(`[index-block] ${elapsed()} persisting block and ${consistent.events.length} event(s)`);
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

            const eventRows = consistent.events.map((event) => {
              const treeIndex = treeIndexMap.get(event.leafHash.toLowerCase()) ?? 0;
              return {
                chainId,
                blockNumber: blockNumberBigInt,
                logIndex: event.logIndex,
                leafHash: event.leafHash,
                canonicalBytes: Buffer.from(event.canonicalBytes).toString("hex"),
                treeIndex,
              };
            });
            await tx.insert(indexedEvents).values(eventRows).onConflictDoNothing();

            await tx
              .update(chains)
              .set({
                latestBlock: sql`greatest(${chains.latestBlock}, ${consistent.latestBlock})`,
                updatedAt: sql`now()`,
              })
              .where(eq(chains.chainId, chainId));
          });

          console.log(`[index-block] ${elapsed()} done chainId=${chainId} blockNumber=${blockNumber} events=${consistent.events.length}`);
        } catch (err: any) {
          console.error(`[index-block] ${elapsed()} error chainId=${chainId} blockNumber=${blockNumber}:`, err);
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
