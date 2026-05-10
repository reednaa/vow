import { createSolanaRpc } from "@solana/kit";
import type { Signature } from "@solana/kit";
import type { Hex } from "viem";
import bs58 from "bs58";
import {
  isEmitCpi,
  extractEmitCpiEncoding,
} from "../core/solana-encoding.ts";

// --- Solana Block Types (from RPC JSON parsed output) ---

export type SolanaIx = {
  programIdIndex: number;
  data: string; // base58-encoded
};

export type SolanaMsg = {
  accountKeys: string[]; // base58 pubkeys
  instructions: SolanaIx[];
};

export type SolanaInnerIxGroup = {
  index: number; // top-level instruction index
  instructions: SolanaIx[];
};

export type SolanaTx = {
  transaction: {
    signatures: string[]; // base58 tx signatures
    message: SolanaMsg;
  };
  meta: {
    innerInstructions?: SolanaInnerIxGroup[];
  } | null;
};

export type SolanaBlock = {
  blockhash: string; // base58
  blockHeight: bigint;
  parentSlot: bigint;
  transactions: SolanaTx[];
};

export type SolanaTxResponse = {
  slot: bigint;
  blockhash: string;
  transaction: SolanaTx["transaction"];
  meta: SolanaTx["meta"];
};

// --- Event extraction result ---

export type SolanaEvent = {
  programId: Uint8Array;
  discriminator: Uint8Array;
  data: Uint8Array;
  canonicalBytes: Uint8Array;
  leafHash: Hex;
  txSignature: string;
  eventIndex: number; // global ordinal within slot
  eventIndexLocal: number; // 0-based position within tx
};

// --- RPC Client ---

export type SolanaRpcClient = {
  getSlot(): Promise<bigint>;
  getBlock(slot: bigint): Promise<SolanaBlock>;
  getTransaction(signature: string): Promise<SolanaTxResponse>;
};

export function createSolanaRpcClient(url: string): SolanaRpcClient {
  const rpc = createSolanaRpc(url);

  return {
    async getSlot() {
      return (await rpc.getSlot().send()) as bigint;
    },

    async getBlock(slot: bigint) {
      const block = await rpc
        .getBlock(slot, {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
          transactionDetails: "full",
          rewards: false,
        })
        .send();
      return block as unknown as SolanaBlock;
    },

    async getTransaction(signature: string) {
      const tx = await rpc
        .getTransaction(signature as Signature, {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send();
      return tx as unknown as SolanaTxResponse;
    },
  };
}

// --- Event Extraction ---

/**
 * Walk a Solana block and extract all emit_cpi!() events.
 *
 * Deterministic walk order:
 *   1. transactions in block.transactions[] order
 *   2. top-level instructions in tx.transaction.message.instructions[] order
 *   3. inner instructions in meta.innerInstructions[ixIndex].instructions[] order
 *
 * Detection: self-CPI + EVENT_IX_TAG (sha256("anchor:event")[0..8])
 */
export function extractEmitCpiEvents(block: SolanaBlock): SolanaEvent[] {
  const events: SolanaEvent[] = [];
  let globalIndex = 0;

  for (const tx of block.transactions) {
    const sigs = tx.transaction?.signatures;
    const txSignature = sigs && sigs.length > 0 ? sigs[0]! : "";
    let localIndex = 0;

    const message = tx.transaction?.message;
    if (!message) continue;

    const staticAccts = message.accountKeys || [];
    const topIxs = message.instructions || [];

    const meta = tx.meta;
    const innerIxGroups = meta?.innerInstructions;

    // Resolve parent program for each top-level ix
    const parentPrograms: (string | null)[] = topIxs.map((ix) => {
      if (ix.programIdIndex != null && staticAccts[ix.programIdIndex]) {
        return staticAccts[ix.programIdIndex]!;
      }
      return null;
    });

    // Walk top-level instructions
    for (let ixIdx = 0; ixIdx < topIxs.length; ixIdx++) {
      const parentProgram = parentPrograms[ixIdx];
      if (!parentProgram) continue;

      // Find inner instructions group for this ix
      if (!innerIxGroups) continue;
      const group = innerIxGroups.find((g) => g.index === ixIdx);
      if (!group) continue;

      for (const innerIx of group.instructions) {
        const innerProgram =
          innerIx.programIdIndex != null
            ? staticAccts[innerIx.programIdIndex] ?? null
            : null;

        if (!innerProgram || !innerIx.data) continue;

        if (isEmitCpi(innerIx.data, innerProgram, parentProgram)) {
          const programIdBytes = bs58.decode(innerProgram);
          const { discriminator, data, canonicalBytes, leafHash } =
            extractEmitCpiEncoding(innerIx.data, programIdBytes);

          events.push({
            programId: programIdBytes,
            discriminator,
            data,
            canonicalBytes,
            leafHash,
            txSignature,
            eventIndex: globalIndex,
            eventIndexLocal: localIndex,
          });

          globalIndex++;
          localIndex++;
        }
      }
    }
  }

  return events;
}
