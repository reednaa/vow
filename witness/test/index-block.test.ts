import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, and } from "drizzle-orm";
import {
  compactSignatureToSignature,
  type Address,
  type Hex,
  parseCompactSignature,
  recoverAddress,
  toHex,
} from "viem";
import { createDb, closeDb } from "../src/db/client";
import { chains, rpcs, indexedBlocks, indexedEvents } from "../src/db/schema";
import { createIndexBlockTask } from "../src/worker/index-block.task";
import { createEnvSigner, computeVowDigest } from "../src/core/signing";
import { caip2ToNumericChainId } from "../src/core/chain-utils";
import { buildMerkleTree, ZERO_HASH } from "../src/core/merkle";
import { encodeEvent, computeLeafHash } from "../src/core/encoding";

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";
const TEST_CHAIN_ID = "eip155:99991";
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const MOCK_BLOCK_HASH = "0x" + "aa".repeat(32) as Hex;
const MOCK_LOGS = [
  {
    address: "0x0000000000000000000000000000000000000001" as Address,
    topics: ["0x" + "11".repeat(32) as Hex],
    data: "0xdeadbeef" as Hex,
    logIndex: 0,
  },
  {
    address: "0x0000000000000000000000000000000000000002" as Address,
    topics: ["0x" + "22".repeat(32) as Hex, "0x" + "33".repeat(32) as Hex],
    data: "0x" as Hex,
    logIndex: 1,
  },
  {
    address: "0x0000000000000000000000000000000000000003" as Address,
    topics: [] as Hex[],
    data: "0x" + "ff".repeat(20) as Hex,
    logIndex: 2,
  },
];

let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  db = createDb(DATABASE_URL);

  // Clean up previous test data
  await db.delete(indexedEvents).where(eq(indexedEvents.chainId, TEST_CHAIN_ID));
  await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, TEST_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));

  // Seed chain + rpcs
  await db.insert(chains).values({
    chainId: TEST_CHAIN_ID,
  });
  await db.insert(rpcs).values([
    { chainId: TEST_CHAIN_ID, url: "http://rpc1.test" },
    { chainId: TEST_CHAIN_ID, url: "http://rpc2.test" },
  ]);
});

afterAll(async () => {
  // Clean up
  await db.delete(indexedEvents).where(eq(indexedEvents.chainId, TEST_CHAIN_ID));
  await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, TEST_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));
  await closeDb();
});

function makeMockConsistentResult(blockNumber: number, events: typeof MOCK_LOGS) {
  const mapped = events.map((log) => {
    const canonicalBytes = encodeEvent(log.address, log.topics, log.data);
    const leafHash = computeLeafHash(canonicalBytes);
    return {
      logIndex: log.logIndex,
      leafHash,
      canonicalBytes,
      emitter: log.address,
      topics: log.topics,
      data: log.data,
    };
  });
  return {
    blockHash: MOCK_BLOCK_HASH,
    blockNumber: BigInt(blockNumber),
    latestBlock: BigInt(blockNumber + 50),
    events: mapped,
  };
}

describe("index-block task", () => {
  it("indexes a block with 3 events correctly", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const blockNumber = 5001;
    const mockResult = makeMockConsistentResult(blockNumber, MOCK_LOGS);
    const task = createIndexBlockTask(db, signer, async () => mockResult);
    await task({ chainId: TEST_CHAIN_ID, blockNumber }, {} as any);

    // Verify indexed_blocks row
    const [block] = await db
      .select()
      .from(indexedBlocks)
      .where(
        and(
          eq(indexedBlocks.chainId, TEST_CHAIN_ID),
          eq(indexedBlocks.blockNumber, BigInt(blockNumber))
        )
      );

    expect(block).toBeTruthy();
    expect(block!.blockHash.toLowerCase()).toBe(MOCK_BLOCK_HASH.toLowerCase());

    // Verify Merkle root matches what buildMerkleTree produces
    const leafHashes = mockResult.events.map((e) => e.leafHash as Hex);
    const { root: expectedRoot } = buildMerkleTree(leafHashes);
    expect(block!.merkleRoot.toLowerCase()).toBe(expectedRoot.toLowerCase());

    // Verify signature recovers to signer address
    const digest = computeVowDigest({
      chainId: caip2ToNumericChainId(TEST_CHAIN_ID),
      rootBlockNumber: BigInt(blockNumber),
      root: expectedRoot,
    });
    const signature = block!.signature as Hex;
    const recoverableSignature = signature.length === 130
      ? compactSignatureToSignature(parseCompactSignature(signature))
      : signature;
    const recovered = await recoverAddress({ hash: digest, signature: recoverableSignature });
    expect(recovered.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());

    // Verify indexed_events (3 rows)
    const events = await db
      .select()
      .from(indexedEvents)
      .where(
        and(
          eq(indexedEvents.chainId, TEST_CHAIN_ID),
          eq(indexedEvents.blockNumber, BigInt(blockNumber))
        )
      );
    expect(events.length).toBe(3);

    // Verify chains.latest_block was updated
    const [chain] = await db
      .select()
      .from(chains)
      .where(eq(chains.chainId, TEST_CHAIN_ID));
    expect(chain!.latestBlock).toBeTruthy();
  });

  it("handles empty block (0 events)", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const blockNumber = 5002;
    const mockResult = makeMockConsistentResult(blockNumber, []);
    const task = createIndexBlockTask(db, signer, async () => mockResult);
    await task({ chainId: TEST_CHAIN_ID, blockNumber }, {} as any);

    const [block] = await db
      .select()
      .from(indexedBlocks)
      .where(
        and(
          eq(indexedBlocks.chainId, TEST_CHAIN_ID),
          eq(indexedBlocks.blockNumber, BigInt(blockNumber))
        )
      );

    expect(block).toBeTruthy();
    expect(block!.merkleRoot).toBe(ZERO_HASH);

    const events = await db
      .select()
      .from(indexedEvents)
      .where(
        and(
          eq(indexedEvents.chainId, TEST_CHAIN_ID),
          eq(indexedEvents.blockNumber, BigInt(blockNumber))
        )
      );
    expect(events.length).toBe(0);
  });

  it("running task twice for same block is idempotent (onConflictDoNothing)", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const blockNumber = 5003;
    const mockResult = makeMockConsistentResult(blockNumber, MOCK_LOGS);
    const task = createIndexBlockTask(db, signer, async () => mockResult);
    await task({ chainId: TEST_CHAIN_ID, blockNumber }, {} as any);
    await task({ chainId: TEST_CHAIN_ID, blockNumber }, {} as any);

    const events = await db
      .select()
      .from(indexedEvents)
      .where(
        and(
          eq(indexedEvents.chainId, TEST_CHAIN_ID),
          eq(indexedEvents.blockNumber, BigInt(blockNumber))
        )
      );
    expect(events.length).toBe(3);
  });

  it("re-enqueues when block is ahead of the tip (latestBlock < blockNumber)", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const blockNumber = 6000;
    const mockResult = makeMockConsistentResult(blockNumber, MOCK_LOGS);
    // Override latestBlock to be behind
    const behindResult = { ...mockResult, latestBlock: BigInt(blockNumber - 5) };

    const addJobCalls: any[] = [];
    const helpers = {
      addJob: async (name: string, payload: any, opts: any) => {
        addJobCalls.push({ name, payload, opts });
      },
    };

    const task = createIndexBlockTask(db, signer, async () => behindResult);
    await task({ chainId: TEST_CHAIN_ID, blockNumber }, helpers as any);

    expect(addJobCalls).toHaveLength(1);
    expect(addJobCalls[0]!.name).toBe("index-block");
    expect(addJobCalls[0]!.payload).toEqual({ chainId: TEST_CHAIN_ID, blockNumber });
    expect(addJobCalls[0]!.opts.runAt).toBeInstanceOf(Date);
  });

  it("re-enqueues with delay when confirmations are insufficient", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const blockNumber = 7000;
    const mockResult = makeMockConsistentResult(blockNumber, MOCK_LOGS);
    // latestBlock is blockNumber + 5, but default confirmations is 12
    const fewConfirmationsResult = { ...mockResult, latestBlock: BigInt(blockNumber + 5) };

    const addJobCalls: any[] = [];
    const helpers = {
      addJob: async (name: string, payload: any, opts: any) => {
        addJobCalls.push({ name, payload, opts });
      },
    };

    const task = createIndexBlockTask(db, signer, async () => fewConfirmationsResult);
    await task({ chainId: TEST_CHAIN_ID, blockNumber }, helpers as any);

    expect(addJobCalls).toHaveLength(1);
    expect(addJobCalls[0]!.name).toBe("index-block");
    expect(addJobCalls[0]!.payload).toEqual({ chainId: TEST_CHAIN_ID, blockNumber });
    expect(addJobCalls[0]!.opts.runAt).toBeInstanceOf(Date);

    // remaining = 12 - 5 = 7, delay = 7 * 5000 = 35000ms
    const expectedRunAt = Date.now() + 35000;
    const actualRunAt = (addJobCalls[0]!.opts.runAt as Date).getTime();
    expect(Math.abs(actualRunAt - expectedRunAt)).toBeLessThan(5000);
  });

  it("proceeds with indexing when confirmations are sufficient", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const blockNumber = 8000;
    const mockResult = makeMockConsistentResult(blockNumber, MOCK_LOGS);

    const addJobCalls: any[] = [];
    const helpers = {
      addJob: async () => { addJobCalls.push("should-not-be-called"); },
    };

    const task = createIndexBlockTask(db, signer, async () => mockResult);
    await task({ chainId: TEST_CHAIN_ID, blockNumber }, helpers as any);

    // Should not have re-enqueued
    expect(addJobCalls).toHaveLength(0);

    // Verify block was indexed
    const [block] = await db
      .select()
      .from(indexedBlocks)
      .where(
        and(
          eq(indexedBlocks.chainId, TEST_CHAIN_ID),
          eq(indexedBlocks.blockNumber, BigInt(blockNumber))
        )
      );
    expect(block).toBeTruthy();
  });
});
