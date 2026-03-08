import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, and } from "drizzle-orm";
import { type Address, type Hex } from "viem";
import { Elysia } from "elysia";
import { createDb, closeDb } from "../src/db/client";
import { chains, rpcs, indexedBlocks, indexedEvents } from "../src/db/schema";
import { createWitnessController } from "../src/api/witness.handler";
import { createHealthServer } from "../src/api/health.server";
import { encodeEvent, computeLeafHash } from "../src/core/encoding";
import { buildMerkleTree, generateProof, verifyProof } from "../src/core/merkle";

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";
const TEST_CHAIN_ID = 99992;
const API_PORT = 13001;
const HEALTH_PORT = 13002;

const MOCK_BLOCK_NUMBER = 7001n;
const MOCK_BLOCK_HASH = "0x" + "bb".repeat(32) as Hex;
const MOCK_SIGNATURE = "0x" + "cc".repeat(65) as Hex;

const MOCK_LOGS: Array<{ address: Address; topics: Hex[]; data: Hex; logIndex: number }> = [
  {
    address: "0x0000000000000000000000000000000000000004" as Address,
    topics: ["0x" + "44".repeat(32) as Hex],
    data: "0xcafe" as Hex,
    logIndex: 0,
  },
  {
    address: "0x0000000000000000000000000000000000000005" as Address,
    topics: ["0x" + "55".repeat(32) as Hex, "0x" + "66".repeat(32) as Hex],
    data: "0x" as Hex,
    logIndex: 1,
  },
  {
    address: "0x0000000000000000000000000000000000000006" as Address,
    topics: [] as Hex[],
    data: "0x1234" as Hex,
    logIndex: 2,
  },
];

let db: ReturnType<typeof createDb>;
let app = new Elysia().onError(({ error, code, set }) => {
  if (code === "VALIDATION") {
    set.status = 400;
    return { error: error.message };
  }
  set.status = 500;
  return { error: String(error) };
});
let healthServer: ReturnType<typeof createHealthServer>;
const BASE_URL = `http://localhost:${API_PORT}`;

beforeAll(async () => {
  db = createDb(DATABASE_URL);

  // Cleanup
  await db.delete(indexedEvents).where(eq(indexedEvents.chainId, TEST_CHAIN_ID));
  await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, TEST_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));
  // Seed chain
  await db.insert(chains).values({
    chainId: TEST_CHAIN_ID,
    caip2: `eip155:${TEST_CHAIN_ID}`,
  });
  await db.insert(rpcs).values([
    { chainId: TEST_CHAIN_ID, url: "http://rpc1.test" },
    { chainId: TEST_CHAIN_ID, url: "http://rpc2.test" },
  ]);

  // Pre-index the block
  const eventsData = MOCK_LOGS.map((log) => {
    const canonicalBytes = encodeEvent(log.address, log.topics, log.data);
    const leafHash = computeLeafHash(canonicalBytes);
    return { leafHash, canonicalBytes, ...log };
  });

  const leafHashes = eventsData.map((e) => e.leafHash as Hex);
  const { root: merkleRoot, tree } = buildMerkleTree(leafHashes);
  const sortedLeaves = tree[0]!;

  await db.insert(indexedBlocks).values({
    chainId: TEST_CHAIN_ID,
    blockNumber: MOCK_BLOCK_NUMBER,
    blockHash: MOCK_BLOCK_HASH,
    merkleRoot,
    latestBlockAtIndex: MOCK_BLOCK_NUMBER + 10n,
    signature: MOCK_SIGNATURE,
  });

  for (const event of eventsData) {
    const treeIndex = sortedLeaves.findIndex(
      (l) => l.toLowerCase() === (event.leafHash as string).toLowerCase()
    );
    await db.insert(indexedEvents).values({
      chainId: TEST_CHAIN_ID,
      blockNumber: MOCK_BLOCK_NUMBER,
      logIndex: event.logIndex,
      leafHash: event.leafHash,
      canonicalBytes: Buffer.from(event.canonicalBytes).toString("hex"),
      treeIndex,
    });
  }

  // Start API server
  const mockAddJob = async () => ({} as any);
  app.use(createWitnessController(db, mockAddJob));
  app.listen(API_PORT);

  healthServer = createHealthServer(HEALTH_PORT);

  // Wait for servers to be ready
  await new Promise((r) => setTimeout(r, 100));
});

afterAll(async () => {
  try { app.stop(); } catch {}
  try { healthServer.stop(); } catch {}
  await db.delete(indexedEvents).where(eq(indexedEvents.chainId, TEST_CHAIN_ID));
  await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, TEST_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));
  await closeDb();
});

describe("GET /witness", () => {
  it("returns ready with valid proof for indexed event", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/eip155:${TEST_CHAIN_ID}/${Number(MOCK_BLOCK_NUMBER)}/0`
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ready");
    expect(body.witness).toBeTruthy();
    expect(body.witness.chainId).toBe(TEST_CHAIN_ID);
    expect(body.witness.rootBlockNumber).toBe(Number(MOCK_BLOCK_NUMBER));
    expect(body.witness.proof).toBeInstanceOf(Array);

    // Verify proof is valid
    const eventsData = MOCK_LOGS.map((log) => {
      const canonicalBytes = encodeEvent(log.address, log.topics, log.data);
      return { ...log, canonicalBytes, leafHash: computeLeafHash(canonicalBytes) };
    });
    const leafHashes = eventsData.map((e) => e.leafHash as Hex);
    const { root, tree } = buildMerkleTree(leafHashes);
    const targetLeaf = eventsData.find((e) => e.logIndex === 0)!;
    const treeIndex = tree[0]!.findIndex(
      (l) => l.toLowerCase() === targetLeaf.leafHash.toLowerCase()
    );
    const expectedProof = generateProof(tree, treeIndex);
    expect(
      verifyProof(body.witness.root as Hex, targetLeaf.leafHash as Hex, body.witness.proof)
    ).toBe(true);
  });

  it("returns 404 for indexed block but non-existent logIndex", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/eip155:${TEST_CHAIN_ID}/${Number(MOCK_BLOCK_NUMBER)}/999`
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown chain", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/eip155:99999/100/0`
    );
    expect(res.status).toBe(404);
  });

  it("returns pending for unindexed block and creates a job", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/eip155:${TEST_CHAIN_ID}/99999/0`
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("pending");

    // Second request should also return pending (job already exists)
    const res2 = await fetch(
      `${BASE_URL}/witness/eip155:${TEST_CHAIN_ID}/99999/0`
    );
    const body2 = await res2.json() as any;
    expect(body2.status).toBe("pending");
  });

  it("returns 400 for malformed CAIP-2", async () => {
    const res = await fetch(`${BASE_URL}/witness/eth:1/100/0`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric blockNumber", async () => {
    const res = await fetch(`${BASE_URL}/witness/eip155:1/abc/0`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric logIndex", async () => {
    const res = await fetch(`${BASE_URL}/witness/eip155:1/100/xyz`);
    expect(res.status).toBe(400);
  });
});

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await fetch(`http://localhost:${HEALTH_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
  });
});
