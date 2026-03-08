import { type Address, type Hex } from "viem";
import { type RpcClient } from "./client.ts";
import { encodeEvent, computeLeafHash, decodeEvent } from "../core/encoding.ts";

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
