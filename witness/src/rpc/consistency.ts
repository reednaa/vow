import { type Address, type Hex } from "viem";
import { type RpcClient } from "./client.ts";
import { encodeEvent, computeLeafHash, decodeEvent } from "../core/encoding.ts";
import type { SolanaRpcClient } from "./solana-client.ts";
import { extractEmitCpiEvents } from "./solana-client.ts";

export type ConsistentBlockResult = {
  blockHash: Hex;
  blockNumber: bigint;
  latestBlock: bigint;
  events: Array<{
    logIndex: number;
    leafHash: Hex;
    canonicalBytes: Uint8Array;
    emitter: Address;
    topics: Hex[];
    data: Hex;
  }>;
};

export type ConsistentSlotResult = {
  blockhash: string;
  slot: bigint;
  latestSlot: bigint;
  events: Array<{
    eventIndex: number;
    eventIndexLocal: number;
    txSignature: string;
    leafHash: Hex;
    canonicalBytes: Uint8Array;
    programId: Uint8Array;
    discriminator: Uint8Array;
    data: Uint8Array;
  }>;
};

export async function fetchBlockConsistent(
  rpcs: RpcClient[],
  blockNumber: bigint
): Promise<ConsistentBlockResult> {
  if (rpcs.length === 0) throw new Error("No RPC clients provided");

  // Fetch block headers in parallel
  const blocks = await Promise.all(rpcs.map((rpc) => rpc.getBlock(blockNumber)));

  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i] === null) {
      throw new Error(`Block ${blockNumber} not available on RPC ${i}`);
    }
  }

  const hashes = blocks.map((b) => b!.hash.toLowerCase());
  const referenceHash = hashes[0];
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] !== referenceHash) {
      throw new Error(
        `Block hash mismatch at block ${blockNumber}: RPC 0 returned ${hashes[0]}, RPC ${i} returned ${hashes[i]}`
      );
    }
  }

  // Fetch logs and head block numbers in parallel
  const [logsPerRpc, headBlocks] = await Promise.all([
    Promise.all(rpcs.map((rpc) => rpc.getLogs(blockNumber))),
    Promise.all(rpcs.map((rpc) => rpc.getBlockNumber())),
  ]);

  // Compute (logIndex, leafHash) tuple sets per RPC
  type EventTuple = { logIndex: number; leafHash: string; canonicalBytes: Uint8Array };
  const eventSetsPerRpc: EventTuple[][] = logsPerRpc.map((logs) =>
    logs
      .sort((a, b) => a.logIndex - b.logIndex)
      .map((log) => {
        const canonicalBytes = encodeEvent(log.address, log.topics, log.data);
        const leafHash = computeLeafHash(canonicalBytes);
        return { logIndex: log.logIndex, leafHash: leafHash.toLowerCase(), canonicalBytes };
      })
  );

  // Compare all RPC event sets to first
  const referenceSet = eventSetsPerRpc[0]!;
  for (let i = 1; i < eventSetsPerRpc.length; i++) {
    const set = eventSetsPerRpc[i]!;
    if (set.length !== referenceSet.length) {
      throw new Error(
        `Event count mismatch at block ${blockNumber}: RPC 0 has ${referenceSet.length} events, RPC ${i} has ${set.length}`
      );
    }
    for (let j = 0; j < referenceSet.length; j++) {
      if (
        set[j]!.logIndex !== referenceSet[j]!.logIndex ||
        set[j]!.leafHash !== referenceSet[j]!.leafHash
      ) {
        throw new Error(
          `Event mismatch at block ${blockNumber}, log ${j}: RPC ${i} disagrees with RPC 0`
        );
      }
    }
  }

  // Reconstruct full event info from first RPC's logs (already consistent)
  const events = referenceSet.map((tuple) => {
    const { emitter, topics, data } = decodeEvent(tuple.canonicalBytes);
    return {
      logIndex: tuple.logIndex,
      leafHash: tuple.leafHash as Hex,
      canonicalBytes: tuple.canonicalBytes,
      emitter,
      topics,
      data,
    };
  });

  const latestBlock = headBlocks.reduce((min, h) => (h < min ? h : min), headBlocks[0]!);

  return {
    blockHash: blocks[0]!.hash,
    blockNumber,
    latestBlock,
    events,
  };
}

const MAX_SOLANA_RETRIES = 2;
const SOLANA_RETRY_DELAY_MS = 3000;

export async function fetchSolanaSlotConsistent(
  rpcs: SolanaRpcClient[],
  slot: bigint,
): Promise<ConsistentSlotResult> {
  if (rpcs.length === 0) throw new Error("No RPC clients provided");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_SOLANA_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(
        `[fetchSolanaSlotConsistent] retry ${attempt}/${MAX_SOLANA_RETRIES} for slot ${slot}: ${lastError?.message}`,
      );
      await new Promise((r) => setTimeout(r, SOLANA_RETRY_DELAY_MS));
    }

    try {
      const result = await tryFetchSolanaSlotConsistent(rpcs, slot);
      return result;
    } catch (err: any) {
      lastError = err;
      // Only retry on event mismatches. Blockhash mismatches are hard errors.
      if (!err.message?.includes("Event")) throw err;
    }
  }

  throw lastError!;
}

async function tryFetchSolanaSlotConsistent(
  rpcs: SolanaRpcClient[],
  slot: bigint,
): Promise<ConsistentSlotResult> {
  const blocks = await Promise.all(rpcs.map((rpc) => rpc.getBlock(slot)));

  const hashes = blocks.map((b) => b.blockhash);
  const referenceHash = hashes[0];
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] !== referenceHash) {
      throw new Error(
        `Blockhash mismatch at slot ${slot}: RPC 0 returned ${hashes[0]}, RPC ${i} returned ${hashes[i]}`,
      );
    }
  }

  // Extract events from each RPC. Build sets keyed by
  // (txSignature, eventIndexLocal) — transaction ordering within
  // a slot is not guaranteed consistent across RPCs, but each
  // transaction's internal event layout must match.
  const allEvents = blocks.map((block) => extractEmitCpiEvents(block));

  const referenceEvents = allEvents[0]!;

  // Collect reference RPC events into a lookup map
  const refMap = new Map<string, typeof referenceEvents[number]>();
  for (const e of referenceEvents) {
    const key = `${e.txSignature}:${e.eventIndexLocal}`;
    refMap.set(key, e);
  }

  // Compare each other RPC against the reference set
  for (let i = 1; i < allEvents.length; i++) {
    const otherEvents = allEvents[i]!;
    if (otherEvents.length !== referenceEvents.length) {
      throw new Error(
        `Event count mismatch at slot ${slot}: RPC 0 has ${referenceEvents.length} events, RPC ${i} has ${otherEvents.length}`,
      );
    }

    for (const e of otherEvents) {
      const key = `${e.txSignature}:${e.eventIndexLocal}`;
      const ref = refMap.get(key);
      if (!ref) {
        throw new Error(
          `Event mismatch at slot ${slot}: RPC ${i} has event (tx=${e.txSignature}, local=${e.eventIndexLocal}) not present in RPC 0`,
        );
      }
      if (ref.leafHash !== e.leafHash) {
        throw new Error(
          `Event mismatch at slot ${slot} tx=${e.txSignature} local=${e.eventIndexLocal}: leafHash RPC 0=${ref.leafHash}, RPC ${i}=${e.leafHash}`,
        );
      }
    }
  }

  // Sort by (txSignature, eventIndexLocal) for a deterministic
  // global ordering that doesn't depend on block tx ordering.
  const sorted = [...referenceEvents].sort((a, b) => {
    const cmp = a.txSignature.localeCompare(b.txSignature);
    if (cmp !== 0) return cmp;
    return a.eventIndexLocal - b.eventIndexLocal;
  });

  // Assign fresh global eventIndex values
  const events = sorted.map((e, idx) => ({
    eventIndex: idx,
    eventIndexLocal: e.eventIndexLocal,
    txSignature: e.txSignature,
    leafHash: e.leafHash,
    canonicalBytes: e.canonicalBytes,
    programId: e.programId,
    discriminator: e.discriminator,
    data: e.data,
  }));

  const headSlots = await Promise.all(rpcs.map((rpc) => rpc.getSlot()));
  const latestSlot = headSlots.reduce(
    (max, s) => (s > max ? s : max),
    headSlots[0]!,
  );

  return {
    blockhash: referenceHash!,
    slot,
    latestSlot,
    events,
  };
}
