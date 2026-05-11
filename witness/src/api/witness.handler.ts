import { Elysia } from "elysia";
import { eq, and } from "drizzle-orm";
import type { Hex } from "viem";
import { chains, indexedBlocks, indexedEvents } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { decodeEvent } from "../core/encoding.ts";
import { normalizeChainId } from "../core/chain-utils.ts";
import { INDEX_BLOCK_TASK } from "../worker/index-block.task.ts";
import { witnessParams, witnessResponse } from "./model.ts";
import { buildStoredEventProof, recoverVowSigner } from "./proof.ts";
import { type AddJobFn, enqueueIndexingJob } from "./jobs.ts";
import { type ApiKeyContext } from "./api-key.middleware.ts";
import { trackUsage } from "./usage-tracker.ts";

export function createWitnessController(
  db: Db,
  addJob: AddJobFn,
  witnessSigner: string = "0x0000000000000000000000000000000000000000"
) {
  return new Elysia().get(
    "/witness/:caip2ChainId/:blockNumber/:logIndex",
    async ({ params, set, apiKey }: any) => {
      const ak = apiKey as ApiKeyContext | undefined;
      const keyId: number | null = ak?.apiKeyId ?? null;
      if (keyId === -1) {
        set.status = 401;
        return { error: "Invalid API key", code: "invalid_api_key" };
      }

      const { caip2ChainId, blockNumber, logIndex } = params;
      const chainId = normalizeChainId(caip2ChainId);
      const blockNumberBigInt = BigInt(blockNumber);

      // Check chain exists
      const [chain] = await db
        .select()
        .from(chains)
        .where(eq(chains.chainId, chainId));

      if (!chain) {
        set.status = 404;
        trackUsage(db, keyId, "status");
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
        const allEvents = await db
          .select()
          .from(indexedEvents)
          .where(
            and(
              eq(indexedEvents.chainId, chainId),
              eq(indexedEvents.blockNumber, blockNumberBigInt)
            )
          );

        const event = allEvents.find(e => e.logIndex === logIndex);
        if (!event) {
          set.status = 404;
          return { error: "Event not found at this logIndex" };
        }

        const proof = buildStoredEventProof(allEvents, event.treeIndex);

        const canonicalBytes = Buffer.from(event.canonicalBytes, "hex");
        const { emitter, topics, data } = decodeEvent(new Uint8Array(canonicalBytes));
        let signatureSigner: string;
        try {
          signatureSigner = await recoverVowSigner({
            chainId,
            rootBlockNumber: blockNumberBigInt,
            root: block.merkleRoot as Hex,
            signature: block.signature as Hex,
          });
        } catch (error) {
          console.error(
            `[witness] signature recovery failed chain=${chainId} block=${blockNumber}: ${String(error)}`
          );
          return { status: "error" as const, error: "Signature recovery failed" };
        }

        console.log(
          `[witness] ready chain=${chainId} block=${blockNumber} logIndex=${logIndex} signerConfigured=${witnessSigner} signerRecovered=${signatureSigner}`
        );

        trackUsage(db, keyId, "hot");

        return {
          status: "ready" as const,
          witness: {
            signer: signatureSigner,
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

      const jobKey = `index:${chainId}:${blockNumber}`;
      const { result, created } = await enqueueIndexingJob({
        db,
        addJob,
        identifier: INDEX_BLOCK_TASK,
        payload: { chainId, blockNumber },
        jobKey,
        maxAttempts: 5,
        failureMessage: "Block indexing failed after max retries",
        priority: keyId ? -1 : 0,
      });
      trackUsage(db, keyId, created ? "cold" : "status");
      return result;
    },
    {
      params: witnessParams,
      response: witnessResponse,
      detail: {
        tags: ["Witness"],
        summary: "Get EVM event witness",
        description:
          "Returns a signed witness payload with Merkle proof for an EVM event identified by chain, block number, and log index. " +
          "If the block hasn't been indexed yet, returns a pending/indexing status and enqueues background indexing.",
      },
    }
  );
}

type WitnessController = ReturnType<typeof createWitnessController>;
type AppWithUse = { use: (plugin: WitnessController) => unknown };

export function mountWitnessHandler<TApp extends AppWithUse>(
  app: TApp,
  db: Db,
  addJob: AddJobFn,
  witnessSigner: string
) {
  app.use(createWitnessController(db, addJob, witnessSigner));
  return app;
}
