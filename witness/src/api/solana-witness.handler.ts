import { Elysia } from "elysia";
import { eq, and, sql } from "drizzle-orm";
import {
  compactSignatureToSignature,
  type Hex,
  parseCompactSignature,
  recoverAddress,
} from "viem";
import { chains, solanaIndexedSlots, solanaIndexedEvents, rpcs } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { buildMerkleTree, generateProof } from "../core/merkle.ts";
import { decodeSolanaEvent } from "../core/solana-encoding.ts";
import { computeVowDigest } from "../core/signing.ts";
import { caip2ToNumericChainId } from "../core/chain-utils.ts";
import { INDEX_SOLANA_SLOT_TASK } from "../worker/index-solana-slot.task.ts";
import { createSolanaRpcClient } from "../rpc/solana-client.ts";
import { solanaWitnessParams, solanaWitnessResponse } from "./model.ts";

export type AddJobFn = (
  identifier: string,
  payload?: any,
  spec?: any,
) => Promise<any>;

const SOLANA_CAIP2_RE =
  /^solana:(mainnet|5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d|devnet|EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG|testnet|4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY)$/;

const CAIP2_ALIASES: Record<string, string> = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
};

function resolveCaip2(raw: string): string {
  const match = SOLANA_CAIP2_RE.exec(raw);
  if (!match) throw new Error(`Invalid Solana CAIP-2: ${raw}`);
  const cluster = match[1]!;
  if (cluster.length > 20) return raw;
  return CAIP2_ALIASES[cluster] ?? raw;
}

export function createSolanaWitnessController(
  db: Db,
  addJob: AddJobFn,
  witnessSigner: string = "0x0000000000000000000000000000000000000000",
) {
  return new Elysia().get(
    "/witness/solana/:caip2ChainId/:txSignature/:index",
    async ({ params, set }) => {
      const { caip2ChainId, txSignature, index } = params;

      let chainId: string;
      try {
        chainId = resolveCaip2(caip2ChainId);
      } catch {
        set.status = 404;
        return { error: "Invalid chain identifier" };
      }

      // Look up chain
      const [chain] = await db
        .select()
        .from(chains)
        .where(eq(chains.chainId, chainId));

      if (!chain) {
        set.status = 404;
        return { error: "Chain not configured" };
      }

      // Look up event by (chainId, txSignature, eventIndexLocal)
      const [event] = await db
        .select()
        .from(solanaIndexedEvents)
        .where(
          and(
            eq(solanaIndexedEvents.chainId, chainId),
            eq(solanaIndexedEvents.txSignature, txSignature),
            eq(solanaIndexedEvents.eventIndexLocal, index),
          ),
        );

      if (event) {
        // Load the indexed slot for this event
        const [slot] = await db
          .select()
          .from(solanaIndexedSlots)
          .where(
            and(
              eq(solanaIndexedSlots.chainId, chainId),
              eq(solanaIndexedSlots.slot, event.slot),
            ),
          );

        if (!slot) {
          set.status = 404;
          return { error: "Indexed slot not found" };
        }

        // Load all events for this slot to reconstruct Merkle tree
        const allEvents = await db
          .select()
          .from(solanaIndexedEvents)
          .where(
            and(
              eq(solanaIndexedEvents.chainId, chainId),
              eq(solanaIndexedEvents.slot, event.slot),
            ),
          );

        // Reconstruct tree
        const sortedEvents = [...allEvents].sort(
          (a: any, b: any) => a.treeIndex - b.treeIndex,
        );
        const leafHashes = sortedEvents.map((e: any) => e.leafHash as Hex);
        const { root, tree } = buildMerkleTree(leafHashes);
        const proof = generateProof(tree, event.treeIndex);

        // Decode canonical bytes
        const canonicalBytes = Buffer.from(event.canonicalBytes, "hex");
        const {
          programId: _programId,
          discriminator,
          data,
        } = decodeSolanaEvent(new Uint8Array(canonicalBytes));

        // Recover signer from EIP-712 signature
        let signatureSigner: string;
        try {
          const signature = slot.signature as Hex;
          const recoverableSignature =
            signature.length === 130
              ? compactSignatureToSignature(parseCompactSignature(signature))
              : signature;
          signatureSigner = await recoverAddress({
            hash: computeVowDigest({
              chainId: caip2ToNumericChainId(chainId),
              rootBlockNumber: BigInt(event.slot.toString()),
              root: slot.merkleRoot as Hex,
            }),
            signature: recoverableSignature,
          });
        } catch (error) {
          console.error(
            `[solana-witness] signature recovery failed chain=${chainId} tx=${txSignature}: ${String(error)}`,
          );
          return { status: "error" as const, error: "Signature recovery failed" };
        }

        console.log(
          `[solana-witness] ready chain=${chainId} tx=${txSignature} index=${index} signerConfigured=${witnessSigner} signerRecovered=${signatureSigner}`,
        );

        return {
          status: "ready" as const,
          witness: {
            signer: signatureSigner,
            chainId,
            latestSlot: Number(slot.latestSlotAtIndex),
            rootSlot: Number(event.slot),
            root: slot.merkleRoot,
            blockhash: slot.blockhash,
            proof,
            signature: slot.signature,
            event: {
              programId: Buffer.from(_programId).toString("hex"),
              discriminator: Buffer.from(discriminator).toString("hex"),
              data: Buffer.from(data).toString("hex"),
            },
          },
        };
      }

      // Pick first RPC for this chain to get the transaction
      const [rpc] = await db.select().from(rpcs).where(eq(rpcs.chainId, chainId)).limit(1);
      const rpcUrl = rpc?.url as string | undefined;

      let resolvedSlot: bigint | null = null;
      if (rpcUrl) {
        try {
          const solanaClient = createSolanaRpcClient(rpcUrl);
          const tx = await solanaClient.getTransaction(txSignature);
          if (tx && tx.slot != null) {
            resolvedSlot = tx.slot;
          }
        } catch (err) {
          console.error(
            `[solana-witness] failed to resolve tx ${txSignature} to slot: ${String(err)}`,
          );
        }
      }

      if (resolvedSlot === null) {
        set.status = 404;
        return { error: "Transaction not found" };
      }

      const slotNum = Number(resolvedSlot);

      // Check for existing Graphile job
      const jobKey = `solana-index:${chainId}:${slotNum}`;
      let job: any = null;
      try {
        const jobRows = await db.execute(
          sql`SELECT id, locked_at, attempts, max_attempts FROM graphile_worker.jobs WHERE key = ${jobKey} LIMIT 1`,
        );
        job = jobRows[0] ?? null;
      } catch {
        // graphile_worker schema not yet installed
      }

      if (job) {
        if (job.locked_at) {
          return { status: "indexing" as const };
        }
        if (job.attempts >= job.max_attempts) {
          return {
            status: "failed" as const,
            error: "Slot indexing failed after max retries",
          };
        }
        return { status: "pending" as const };
      }

      // No job — enqueue one
      await addJob(
        INDEX_SOLANA_SLOT_TASK,
        { chainId, slot: slotNum },
        { jobKey, maxAttempts: 5 },
      );

      return { status: "pending" as const };
    },
    { params: solanaWitnessParams, response: solanaWitnessResponse },
  );
}

type SolanaWitnessController = ReturnType<typeof createSolanaWitnessController>;
type AppWithUse = { use: (plugin: SolanaWitnessController) => unknown };

export function mountSolanaWitnessHandler<TApp extends AppWithUse>(
  app: TApp,
  db: Db,
  addJob: AddJobFn,
  witnessSigner: string,
) {
  app.use(createSolanaWitnessController(db, addJob, witnessSigner));
  return app;
}
