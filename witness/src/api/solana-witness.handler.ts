import { Elysia } from "elysia";
import { eq, and } from "drizzle-orm";
import type { Hex } from "viem";
import { chains, solanaIndexedSlots, solanaIndexedEvents, rpcs } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { decodeSolanaEvent } from "../core/solana-encoding.ts";
import { normalizeChainId } from "../core/chain-utils.ts";
import { INDEX_SOLANA_SLOT_TASK } from "../worker/index-solana-slot.task.ts";
import { createSolanaRpcClient } from "../rpc/solana-client.ts";
import { solanaWitnessParams, solanaWitnessResponse } from "./model.ts";
import { buildStoredEventProof, recoverVowSigner } from "./proof.ts";
import { type AddJobFn, enqueueIndexingJob } from "./jobs.ts";
import { type ApiKeyContext } from "./api-key.middleware.ts";
import { trackUsage } from "./usage-tracker.ts";

export function createSolanaWitnessController(
  db: Db,
  addJob: AddJobFn,
  witnessSigner: string = "0x0000000000000000000000000000000000000000",
) {
  return new Elysia().get(
    "/witness/solana/:caip2ChainId/:txSignature/:index",
    async ({ params, set, apiKey }: any) => {
      const ak = apiKey as ApiKeyContext | undefined;
      const keyId: number | null = ak?.apiKeyId ?? null;
      if (keyId === -1) {
        set.status = 401;
        return { error: "Invalid API key", code: "invalid_api_key" };
      }

      const { caip2ChainId, txSignature, index } = params;

      let chainId: string;
      try {
        chainId = normalizeChainId(caip2ChainId);
      } catch {
        set.status = 404;
        trackUsage(db, keyId, "status");
        return { error: "Invalid chain identifier" };
      }

      // Look up chain
      const [chain] = await db
        .select()
        .from(chains)
        .where(eq(chains.chainId, chainId));

      if (!chain) {
        set.status = 404;
        trackUsage(db, keyId, "status");
        return { error: "Chain not configured" };
      }

      // Look up slot by (chainId, txSignature, eventIndexLocal)
      const [eventLookup] = await db
        .select({ slot: solanaIndexedEvents.slot })
        .from(solanaIndexedEvents)
        .where(
          and(
            eq(solanaIndexedEvents.chainId, chainId),
            eq(solanaIndexedEvents.txSignature, txSignature),
            eq(solanaIndexedEvents.eventIndexLocal, index),
          ),
        );

      if (eventLookup) {
        // Load the indexed slot for this event
        const [slot] = await db
          .select()
          .from(solanaIndexedSlots)
          .where(
            and(
              eq(solanaIndexedSlots.chainId, chainId),
              eq(solanaIndexedSlots.slot, eventLookup.slot),
            ),
          );

        if (!slot) {
          set.status = 404;
          trackUsage(db, keyId, "status");
          return { error: "Indexed slot not found" };
        }

        const allEvents = await db
          .select()
          .from(solanaIndexedEvents)
          .where(
            and(
              eq(solanaIndexedEvents.chainId, chainId),
              eq(solanaIndexedEvents.slot, eventLookup.slot),
            ),
          );

        const event = allEvents.find(e => e.eventIndexLocal === Number(index));
        if (!event) {
          set.status = 404;
          trackUsage(db, keyId, "status");
          return { error: "Event not found" };
        }

        const proof = buildStoredEventProof(allEvents, event.treeIndex);

        const canonicalBytes = Buffer.from(event.canonicalBytes, "hex");
        const {
          programId: _programId,
          discriminator,
          data,
        } = decodeSolanaEvent(new Uint8Array(canonicalBytes));

        // Recover signer from EIP-712 signature
        let signatureSigner: string;
        try {
          signatureSigner = await recoverVowSigner({
            chainId,
            rootBlockNumber: event.slot,
            root: slot.merkleRoot as Hex,
            signature: slot.signature as Hex,
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

        trackUsage(db, keyId, "hot");

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
        trackUsage(db, keyId, "status");
        return { error: "Transaction not found" };
      }

      const slotNum = Number(resolvedSlot);
      const [indexedSlot] = await db
        .select()
        .from(solanaIndexedSlots)
        .where(
          and(
            eq(solanaIndexedSlots.chainId, chainId),
            eq(solanaIndexedSlots.slot, resolvedSlot),
          ),
        );

      if (indexedSlot) {
        set.status = 404;
        trackUsage(db, keyId, "status");
        return { error: "Event not found at this event index" };
      }

      const jobKey = `solana-index:${chainId}:${slotNum}`;
      const { result, created } = await enqueueIndexingJob({
        db,
        addJob,
        identifier: INDEX_SOLANA_SLOT_TASK,
        payload: { chainId, slot: slotNum },
        jobKey,
        maxAttempts: 5,
        failureMessage: "Slot indexing failed after max retries",
        priority: keyId ? -1 : 0,
      });
      trackUsage(db, keyId, created ? "cold" : "status");
      return result;
    },
    {
      params: solanaWitnessParams,
      response: solanaWitnessResponse,
      detail: {
        tags: ["Solana Witness"],
        summary: "Get Solana event witness",
        description:
          "Returns a signed witness payload with Merkle proof for a Solana CPI event identified by chain, transaction signature, and event index. " +
          "If the slot hasn't been indexed yet, returns a pending/indexing status and enqueues background indexing.",
      },
    },
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
