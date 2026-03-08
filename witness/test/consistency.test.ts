import { describe, it, expect } from "bun:test";
import { type Address, type Hex, toHex } from "viem";
import { type RpcClient } from "../src/rpc/client";
import { fetchBlockConsistent } from "../src/rpc/consistency";
import { encodeEvent, computeLeafHash } from "../src/core/encoding";

function makeAddress(n: number): Address {
  return `0x${n.toString(16).padStart(40, "0")}` as Address;
}

function makeTopic(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

function makeRpcClient(options: {
  blockHash?: Hex;
  blockNumber?: bigint;
  blockNotFound?: boolean;
  logs?: Array<{ address: Address; topics: Hex[]; data: Hex; logIndex: number }>;
  headBlock?: bigint;
}): RpcClient {
  const {
    blockHash = "0xaabbccdd" + "00".repeat(28) as Hex,
    blockNumber = 100n,
    blockNotFound = false,
    logs = [],
    headBlock = 200n,
  } = options;

  return {
    async getBlock(bn: bigint) {
      if (blockNotFound) return null;
      return { hash: blockHash, number: blockNumber };
    },
    async getLogs(_bn: bigint) {
      return logs;
    },
    async getBlockNumber() {
      return headBlock;
    },
  };
}

const BLOCK_HASH = "0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd" as Hex;

const SAMPLE_LOGS = [
  {
    address: makeAddress(1),
    topics: [makeTopic(10), makeTopic(11)],
    data: "0xdeadbeef" as Hex,
    logIndex: 0,
  },
  {
    address: makeAddress(2),
    topics: [makeTopic(20)],
    data: "0x" as Hex,
    logIndex: 1,
  },
];

describe("fetchBlockConsistent", () => {
  it("happy path: 2 RPCs agree on block and events", async () => {
    const rpcs = [
      makeRpcClient({ blockHash: BLOCK_HASH, logs: SAMPLE_LOGS, headBlock: 200n }),
      makeRpcClient({ blockHash: BLOCK_HASH, logs: SAMPLE_LOGS, headBlock: 250n }),
    ];
    const result = await fetchBlockConsistent(rpcs, 100n);
    expect(result.blockHash.toLowerCase()).toBe(BLOCK_HASH.toLowerCase());
    expect(result.blockNumber).toBe(100n);
    expect(result.events.length).toBe(2);
    expect(result.latestBlock).toBe(200n); // minimum of 200 and 250
  });

  it("3 RPCs all agreeing", async () => {
    const rpcs = [
      makeRpcClient({ blockHash: BLOCK_HASH, logs: SAMPLE_LOGS, headBlock: 300n }),
      makeRpcClient({ blockHash: BLOCK_HASH, logs: SAMPLE_LOGS, headBlock: 200n }),
      makeRpcClient({ blockHash: BLOCK_HASH, logs: SAMPLE_LOGS, headBlock: 250n }),
    ];
    const result = await fetchBlockConsistent(rpcs, 100n);
    expect(result.events.length).toBe(2);
    expect(result.latestBlock).toBe(200n);
  });

  it("block hash mismatch throws", async () => {
    const rpcs = [
      makeRpcClient({ blockHash: BLOCK_HASH }),
      makeRpcClient({ blockHash: "0x" + "ff".repeat(32) as Hex }),
    ];
    await expect(fetchBlockConsistent(rpcs, 100n)).rejects.toThrow(/mismatch/i);
  });

  it("missing block throws", async () => {
    const rpcs = [
      makeRpcClient({ blockHash: BLOCK_HASH }),
      makeRpcClient({ blockNotFound: true }),
    ];
    await expect(fetchBlockConsistent(rpcs, 100n)).rejects.toThrow();
  });

  it("event mismatch throws", async () => {
    const differentLogs = [{ ...SAMPLE_LOGS[0]!, data: "0x12345678" as Hex }];
    const rpcs = [
      makeRpcClient({ blockHash: BLOCK_HASH, logs: SAMPLE_LOGS }),
      makeRpcClient({ blockHash: BLOCK_HASH, logs: differentLogs }),
    ];
    await expect(fetchBlockConsistent(rpcs, 100n)).rejects.toThrow(/mismatch/i);
  });

  it("empty block succeeds with empty events", async () => {
    const rpcs = [
      makeRpcClient({ blockHash: BLOCK_HASH, logs: [], headBlock: 100n }),
      makeRpcClient({ blockHash: BLOCK_HASH, logs: [], headBlock: 150n }),
    ];
    const result = await fetchBlockConsistent(rpcs, 100n);
    expect(result.events).toEqual([]);
    expect(result.latestBlock).toBe(100n);
  });

  it("latestBlock is minimum of all RPC head block numbers", async () => {
    const rpcs = [
      makeRpcClient({ blockHash: BLOCK_HASH, logs: [], headBlock: 500n }),
      makeRpcClient({ blockHash: BLOCK_HASH, logs: [], headBlock: 100n }),
      makeRpcClient({ blockHash: BLOCK_HASH, logs: [], headBlock: 300n }),
    ];
    const result = await fetchBlockConsistent(rpcs, 50n);
    expect(result.latestBlock).toBe(100n);
  });

  it("events have correct leaf hashes", async () => {
    const rpcs = [
      makeRpcClient({ blockHash: BLOCK_HASH, logs: SAMPLE_LOGS }),
      makeRpcClient({ blockHash: BLOCK_HASH, logs: SAMPLE_LOGS }),
    ];
    const result = await fetchBlockConsistent(rpcs, 100n);
    for (const event of result.events) {
      const expectedHash = computeLeafHash(
        encodeEvent(event.emitter, event.topics, event.data)
      );
      expect(event.leafHash.toLowerCase()).toBe(expectedHash.toLowerCase());
    }
  });
});
