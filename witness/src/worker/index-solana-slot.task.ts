import { type Task } from "graphile-worker";
import { eq, sql } from "drizzle-orm";
import { caip2ToNumericChainId } from "../core/chain-utils.ts";
import { type Hex } from "viem";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { createSolanaRpcClient, type SolanaRpcClient } from "../rpc/solana-client.ts";
import { instrumentSolanaRpcClient } from "../rpc/instrumented-client.ts";
import {
  fetchSolanaSlotConsistent,
  type ConsistentSlotResult,
} from "../rpc/consistency.ts";
import { buildMerkleTree, ZERO_HASH } from "../core/merkle.ts";
import { chains, rpcs, solanaIndexedSlots, solanaIndexedEvents } from "../db/schema.ts";
import type { Signer } from "../core/signer.interface.ts";
import type { createDb } from "../db/client.ts";

export const INDEX_SOLANA_SLOT_TASK = "index-solana-slot" as const;

export type IndexSolanaSlotPayload = {
  chainId: string;
  slot: number;
};

type Db = ReturnType<typeof createDb>;
type FetchSlotFn = (
  rpcs: SolanaRpcClient[],
  slot: bigint,
) => Promise<ConsistentSlotResult>;

export function createIndexSolanaSlotTask(
  db: Db,
  signer: Signer,
  fetchSlot?: FetchSlotFn,
): Task {
  return async (payload) => {
    const { chainId, slot } = payload as IndexSolanaSlotPayload;
    const slotBigInt = BigInt(slot);

    const startTime = Date.now();
    const elapsed = () => `+${Date.now() - startTime}ms`;

    console.log(`[index-solana-slot] start chainId=${chainId} slot=${slot}`);

    const tracer = trace.getTracer("vow-witness");
    await tracer.startActiveSpan(
      "index-solana-slot",
      { attributes: { "chain.id": chainId, "solana.slot": slot } },
      async (span) => {
        try {
          console.log(`[index-solana-slot] ${elapsed()} fetching RPC URLs for chainId=${chainId}`);
          const rpcRows = await db
            .select({ url: rpcs.url })
            .from(rpcs)
            .where(eq(rpcs.chainId, chainId));

          console.log(`[index-solana-slot] ${elapsed()} found ${rpcRows.length} RPC(s) for chainId=${chainId}`);

          if (rpcRows.length < 2) {
            throw new Error(
              `Chain ${chainId} has only ${rpcRows.length} RPC(s). At least 2 required.`,
            );
          }

          const parentContext = trace.setSpan(context.active(), span);
          const rpcClients = rpcRows.map((row) =>
            instrumentSolanaRpcClient(
              createSolanaRpcClient(row.url),
              { url: row.url, chainId },
              parentContext,
            ),
          );

          console.log(`[index-solana-slot] ${elapsed()} fetching slot ${slot} from ${rpcClients.length} RPC(s)`);
          const fetcher = fetchSlot ?? fetchSolanaSlotConsistent;
          const consistent = await fetcher(rpcClients, slotBigInt);

          console.log(
            `[index-solana-slot] ${elapsed()} slot fetched blockhash=${consistent.blockhash} events=${consistent.events.length} latestSlot=${consistent.latestSlot}`,
          );

          // Handle empty slot
          if (consistent.events.length === 0) {
            console.log(`[index-solana-slot] ${elapsed()} empty slot, signing zero-root vow`);
            const sig = await signer.signVow({
              chainId: caip2ToNumericChainId(chainId),
              rootBlockNumber: slotBigInt,
              root: ZERO_HASH,
            });

            console.log(`[index-solana-slot] ${elapsed()} persisting empty slot chainId=${chainId} slot=${slot}`);
            await db.transaction(async (tx) => {
              await tx
                .insert(solanaIndexedSlots)
                .values({
                  chainId,
                  slot: slotBigInt,
                  blockhash: consistent.blockhash,
                  merkleRoot: ZERO_HASH,
                  latestSlotAtIndex: consistent.latestSlot,
                  signature: sig,
                })
                .onConflictDoNothing();

              await tx
                .update(chains)
                .set({
                  latestBlock: sql`greatest(${chains.latestBlock}, ${consistent.latestSlot})`,
                  updatedAt: sql`now()`,
                })
                .where(eq(chains.chainId, chainId));
            });

            console.log(`[index-solana-slot] ${elapsed()} done (empty) chainId=${chainId} slot=${slot}`);
            return;
          }

          // Build Merkle tree from leaf hashes
          console.log(`[index-solana-slot] ${elapsed()} building merkle tree from ${consistent.events.length} leaf(ves)`);
          const leafHashes = consistent.events.map((e) => e.leafHash as Hex);
          const { root: merkleRoot, tree } = buildMerkleTree(leafHashes);
          console.log(`[index-solana-slot] ${elapsed()} merkle root=${merkleRoot}`);

          // Determine tree index (position in sorted leaf array = tree[0])
          const sortedLeaves = tree[0]!;
          const treeIndexMap = new Map<string, number>();
          for (let i = 0; i < sortedLeaves.length; i++) {
            treeIndexMap.set(sortedLeaves[i]!.toLowerCase(), i);
          }

          // Sign the Vow struct
          console.log(`[index-solana-slot] ${elapsed()} signing vow chainId=${chainId} slot=${slot} root=${merkleRoot}`);
          const sig = await signer.signVow({
            chainId: caip2ToNumericChainId(chainId),
            rootBlockNumber: slotBigInt,
            root: merkleRoot,
          });

          // Write everything in a single transaction
          console.log(`[index-solana-slot] ${elapsed()} persisting slot and ${consistent.events.length} event(s)`);
          await db.transaction(async (tx) => {
            await tx
              .insert(solanaIndexedSlots)
              .values({
                chainId,
                slot: slotBigInt,
                blockhash: consistent.blockhash,
                merkleRoot,
                latestSlotAtIndex: consistent.latestSlot,
                signature: sig,
              })
              .onConflictDoNothing();

            const eventRows = consistent.events.map((event) => {
              const treeIndex = treeIndexMap.get(event.leafHash.toLowerCase()) ?? 0;
              return {
                chainId,
                slot: slotBigInt,
                txSignature: event.txSignature,
                eventIndexLocal: event.eventIndexLocal,
                eventIndex: event.eventIndex,
                leafHash: event.leafHash,
                canonicalBytes: Buffer.from(event.canonicalBytes).toString("hex"),
                treeIndex,
              };
            });
            await tx.insert(solanaIndexedEvents).values(eventRows).onConflictDoNothing();

            await tx
              .update(chains)
              .set({
                latestBlock: sql`greatest(${chains.latestBlock}, ${consistent.latestSlot})`,
                updatedAt: sql`now()`,
              })
              .where(eq(chains.chainId, chainId));
          });

          console.log(`[index-solana-slot] ${elapsed()} done chainId=${chainId} slot=${slot} events=${consistent.events.length}`);
        } catch (err: any) {
          console.error(`[index-solana-slot] ${elapsed()} error chainId=${chainId} slot=${slot}:`, err);
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  };
}
