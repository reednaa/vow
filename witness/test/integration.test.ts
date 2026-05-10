import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, and } from "drizzle-orm";
import {
  compactSignatureToSignature,
  type Address,
  type Hex,
  parseCompactSignature,
  recoverAddress,
  toBytes,
} from "viem";
import { Elysia } from "elysia";
import { createDb, closeDb } from "../src/db/client";
import { chains, rpcs, indexedBlocks, indexedEvents } from "../src/db/schema";
import { setupWorker } from "../src/worker/setup";
import { createWitnessController } from "../src/api/witness.handler";
import { encodeEvent, computeLeafHash } from "../src/core/encoding";
import { buildMerkleTree, verifyProof } from "../src/core/merkle";
import { createEnvSigner, computeVowDigest } from "../src/core/signing";
import { caip2ToNumericChainId } from "../src/core/chain-utils";
import { type ConsistentBlockResult } from "../src/rpc/consistency";

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";
const TEST_CHAIN_ID = "eip155:99993";
const API_PORT = 13003;

const BLOCK_NUMBER = 100n;
const BLOCK_HASH = ("0x" + "ab".repeat(32)) as Hex;
const LATEST_BLOCK = 200n;

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const MOCK_LOGS: Array<{
  address: Address;
  topics: Hex[];
  data: Hex;
  logIndex: number;
}> = [
  {
    address: "0x0000000000000000000000000000000000000001" as Address,
    topics: [("0x" + "11".repeat(32)) as Hex],
    data: "0xdead" as Hex,
    logIndex: 0,
  },
  {
    address: "0x0000000000000000000000000000000000000002" as Address,
    topics: [
      ("0x" + "22".repeat(32)) as Hex,
      ("0x" + "33".repeat(32)) as Hex,
    ],
    data: "0x" as Hex,
    logIndex: 1,
  },
  {
    address: "0x0000000000000000000000000000000000000003" as Address,
    topics: [] as Hex[],
    data: "0xbeef" as Hex,
    logIndex: 2,
  },
];

function mockFetchBlock(
  _rpcs: any[],
  blockNumber: bigint
): Promise<ConsistentBlockResult> {
  if (blockNumber !== BLOCK_NUMBER) {
    throw new Error(`Unexpected block number: ${blockNumber}`);
  }
  const events = MOCK_LOGS.map((log) => {
    const canonicalBytes = encodeEvent(log.address, log.topics, log.data);
    const leafHash = computeLeafHash(canonicalBytes) as Hex;
    return {
      logIndex: log.logIndex,
      leafHash,
      canonicalBytes,
      emitter: log.address,
      topics: log.topics,
      data: log.data,
    };
  });
  return Promise.resolve({
    blockHash: BLOCK_HASH,
    blockNumber: BLOCK_NUMBER,
    latestBlock: LATEST_BLOCK,
    events,
  });
}

let db: ReturnType<typeof createDb>;
let worker: Awaited<ReturnType<typeof setupWorker>>;
let app = new Elysia().onError(({ error, set }) => {
  set.status = 500;
  return { error: String(error) };
});
const BASE_URL = `http://localhost:${API_PORT}`;

beforeAll(async () => {
  db = createDb(DATABASE_URL);

  // Cleanup any leftover data
  await db.delete(indexedEvents).where(eq(indexedEvents.chainId, TEST_CHAIN_ID));
  await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, TEST_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));

  // Seed chain + RPCs
  await db.insert(chains).values({ chainId: TEST_CHAIN_ID });
  await db.insert(rpcs).values([
    { chainId: TEST_CHAIN_ID, url: "http://mock-rpc1.test" },
    { chainId: TEST_CHAIN_ID, url: "http://mock-rpc2.test" },
  ]);

  const signer = createEnvSigner(ANVIL_KEY);
  worker = await setupWorker({
    databaseUrl: DATABASE_URL,
    signer,
    db,
    fetchBlock: mockFetchBlock,
  });

  app.use(createWitnessController(db, worker.addJob, signer.address()));
  app.listen(API_PORT);

  await new Promise((r) => setTimeout(r, 100));
});

afterAll(async () => {
  try {
    app.stop();
  } catch {}
  try {
    await worker.stop();
  } catch {}
  await db.delete(indexedEvents).where(eq(indexedEvents.chainId, TEST_CHAIN_ID));
  await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, TEST_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));
  await closeDb();
});

async function pollForIndexedBlock(
  chainId: string,
  blockNumber: bigint,
  timeoutMs = 15_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(indexedBlocks)
      .where(
        and(
          eq(indexedBlocks.chainId, chainId),
          eq(indexedBlocks.blockNumber, blockNumber)
        )
      );
    if (row) return row;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Timeout waiting for block ${blockNumber} to be indexed on chain ${chainId}`
  );
}

describe("Integration: request → job → index → proof", () => {
  it("first GET returns pending and enqueues a job", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/${TEST_CHAIN_ID}/${Number(BLOCK_NUMBER)}/0`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("pending");
  });

  it("worker indexes the block (polls until ready, timeout 15s)", async () => {
    await pollForIndexedBlock(TEST_CHAIN_ID, BLOCK_NUMBER);
  });

  it("returns ready with full witness for logIndex 0", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/${TEST_CHAIN_ID}/${Number(BLOCK_NUMBER)}/0`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ready");
    expect(body.witness.chainId).toBe(TEST_CHAIN_ID);
    expect(body.witness.rootBlockNumber).toBe(Number(BLOCK_NUMBER));
    expect(body.witness.proof).toBeInstanceOf(Array);

    // Verify Merkle proof
    const leafHashes = MOCK_LOGS.map((log) => {
      const cb = encodeEvent(log.address, log.topics, log.data);
      return computeLeafHash(cb) as Hex;
    });
    const { root, tree } = buildMerkleTree(leafHashes);

    const targetCb = encodeEvent(
      MOCK_LOGS[0]!.address,
      MOCK_LOGS[0]!.topics,
      MOCK_LOGS[0]!.data
    );
    const targetLeafHash = computeLeafHash(targetCb) as Hex;

    expect(
      verifyProof(
        body.witness.root as Hex,
        targetLeafHash,
        body.witness.proof
      )
    ).toBe(true);

    // Verify signature recovers to the Anvil key #0 address
    const digest = computeVowDigest({
      chainId: caip2ToNumericChainId(TEST_CHAIN_ID),
      rootBlockNumber: BLOCK_NUMBER,
      root: body.witness.root as Hex,
    });
    const sigHex = body.witness.signature as Hex;
    const recoverableSignature = sigHex.length === 130
      ? compactSignatureToSignature(parseCompactSignature(sigHex))
      : sigHex;
    const recovered = await recoverAddress({ hash: digest, signature: recoverableSignature });
    const signer = createEnvSigner(ANVIL_KEY);
    expect(recovered.toLowerCase()).toBe(signer.address().toLowerCase());
  });

  it("returns 404 for logIndex 999 (not in block)", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/${TEST_CHAIN_ID}/${Number(BLOCK_NUMBER)}/999`
    );
    expect(res.status).toBe(404);
  });

  it("returns ready for logIndex 1 in the same block", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/${TEST_CHAIN_ID}/${Number(BLOCK_NUMBER)}/1`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ready");
  });

  it("returns 404 for unknown chainId", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/eip155:99999/${Number(BLOCK_NUMBER)}/0`
    );
    expect(res.status).toBe(404);
  });
});
