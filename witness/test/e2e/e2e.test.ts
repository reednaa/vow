import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { eq, and } from "drizzle-orm";
import {
  compactSignatureToSignature,
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  defineChain,
  parseCompactSignature,
  toHex,
  recoverAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Elysia } from "elysia";
import { createDb, closeDb } from "../../src/db/client";
import { chains, rpcs, indexedBlocks, indexedEvents } from "../../src/db/schema";
import { setupWorker } from "../../src/worker/setup";
import { mountWitnessHandler } from "../../src/api/witness.handler";
import { encodeEvent, computeLeafHash } from "../../src/core/encoding";
import { verifyProof } from "../../src/core/merkle";
import { createEnvSigner, computeVowDigest } from "../../src/core/signing";
import { caip2ToNumericChainId } from "../../src/core/chain-utils";
import { encodeVow } from "../../src/client/index";
import { startAnvil, stopAnvil, TEST_RPC_URL, TEST_CHAIN_ID } from "./harness";

// ── constants ────────────────────────────────────────────────────────────────

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";
const TEST_CHAIN_ID_NUMERIC = 31337;
const API_PORT = 13004;

const ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ANVIL_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

const TAG = ("0x" + "ab".repeat(32)) as Hex;
const PAYLOAD_HEX = toHex(new TextEncoder().encode("hello world")) as Hex;

// ── ABIs ─────────────────────────────────────────────────────────────────────

const testEmitterAbi = [
  {
    type: "function",
    name: "emitEvent",
    inputs: [
      { name: "tag", type: "bytes32" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const mockVowLibAbi = [
  {
    type: "function",
    name: "processVow",
    inputs: [
      { name: "directory", type: "address" },
      { name: "vow", type: "bytes" },
    ],
    outputs: [
      { name: "chainId", type: "uint256" },
      { name: "rootBlockNumber", type: "uint256" },
      { name: "emitter", type: "address" },
      { name: "topics", type: "bytes32[]" },
      { name: "data", type: "bytes" },
    ],
    stateMutability: "view",
  },
] as const;

// ── helpers ───────────────────────────────────────────────────────────────────

async function pollForIndexedBlock(
  db: ReturnType<typeof createDb>,
  chainId: string,
  blockNumber: bigint,
  timeoutMs = 20_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(indexedBlocks)
      .where(
        and(eq(indexedBlocks.chainId, chainId), eq(indexedBlocks.blockNumber, blockNumber))
      );
    if (row) return row;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout waiting for block ${blockNumber} to be indexed on chain ${chainId}`);
}

// ── test state ────────────────────────────────────────────────────────────────

type Addresses = {
  witnessDirectory: Address;
  mockVowLib: Address;
  testEmitter: Address;
};

let addresses: Addresses;
let db: ReturnType<typeof createDb>;
let worker: Awaited<ReturnType<typeof setupWorker>>;
let app = new Elysia().onError(({ error, set }) => {
  set.status = 500;
  return { error: String(error) };
});
let eventBlockNumber: bigint;
let eventLogIndex: number;

const BASE_URL = `http://localhost:${API_PORT}`;

const anvilChain = defineChain({
  id: TEST_CHAIN_ID_NUMERIC,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [TEST_RPC_URL] } },
});

const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Load deployed contract addresses
  addresses = JSON.parse(
    readFileSync(new URL("./addresses.json", import.meta.url).pathname, "utf-8")
  ) as Addresses;

  // Start anvil with pre-deployed state
  await startAnvil();

  const publicClient = createPublicClient({ chain: anvilChain, transport: http(TEST_RPC_URL) });
  const walletClient = createWalletClient({
    chain: anvilChain,
    transport: http(TEST_RPC_URL),
    account,
  });
  const testClient = createTestClient({
    chain: anvilChain,
    transport: http(TEST_RPC_URL),
    mode: "anvil",
  });

  // Emit test event on-chain
  const txHash = await walletClient.writeContract({
    address: addresses.testEmitter,
    abi: testEmitterAbi,
    functionName: "emitEvent",
    args: [TAG, PAYLOAD_HEX],
  });
  const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  eventBlockNumber = txReceipt.blockNumber;
  eventLogIndex = txReceipt.logs[0]!.logIndex!;

  // Mine 10 more blocks so latestBlock > eventBlock
  await testClient.mine({ blocks: 10 });

  // Seed DB
  db = createDb(DATABASE_URL);

  await db.delete(indexedEvents).where(eq(indexedEvents.chainId, TEST_CHAIN_ID));
  await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, TEST_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));

  await db.insert(chains).values({ chainId: TEST_CHAIN_ID });
  // Two RPC rows required by index-block task (both pointing to the same local anvil)
  await db.insert(rpcs).values([
    { chainId: TEST_CHAIN_ID, url: TEST_RPC_URL },
    { chainId: TEST_CHAIN_ID, url: TEST_RPC_URL },
  ]);

  const signer = createEnvSigner(ANVIL_PRIVATE_KEY);

  worker = await setupWorker({ databaseUrl: DATABASE_URL, signer, db });

  mountWitnessHandler(app, db, worker.addJob, signer.address());
  app.listen(API_PORT);

  // Allow server to settle
  await new Promise((r) => setTimeout(r, 100));
});

afterAll(async () => {
  try { app.stop(); } catch {}
  try { await worker.stop(); } catch {}
  if (db) {
    await db.delete(indexedEvents).where(eq(indexedEvents.chainId, TEST_CHAIN_ID));
    await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, TEST_CHAIN_ID));
    await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
    await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));
    await closeDb();
  }
  await stopAnvil();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("E2E: anvil → witness → on-chain processVow", () => {
  it("first GET returns pending and enqueues a job", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/${TEST_CHAIN_ID}/${Number(eventBlockNumber)}/${eventLogIndex}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("pending");
  });

  it("worker indexes the block using real RPC (polls until ready, timeout 20s)", async () => {
    await pollForIndexedBlock(db, TEST_CHAIN_ID, eventBlockNumber);
  });

  it("returns ready with valid Merkle proof and recoverable signature", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/${TEST_CHAIN_ID}/${Number(eventBlockNumber)}/${eventLogIndex}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ready");

    const { witness } = body;
    expect(witness.chainId).toBe(TEST_CHAIN_ID);
    expect(witness.rootBlockNumber).toBe(Number(eventBlockNumber));

    // Verify Merkle proof
    const eventBytes = encodeEvent(
      witness.event.emitter as Address,
      witness.event.topics as Hex[],
      witness.event.data as Hex
    );
    const leafHash = computeLeafHash(eventBytes) as Hex;
    expect(verifyProof(witness.root as Hex, leafHash, witness.proof)).toBe(true);

    // Verify signature recovers to Anvil key #0
    const digest = computeVowDigest({
      chainId: caip2ToNumericChainId(TEST_CHAIN_ID),
      rootBlockNumber: BigInt(witness.rootBlockNumber),
      root: witness.root as Hex,
    });
    const signature = witness.signature as Hex;
    const recoverableSignature = signature.length === 130
      ? compactSignatureToSignature(parseCompactSignature(signature))
      : signature;
    const recovered = await recoverAddress({ hash: digest, signature: recoverableSignature });
    expect(recovered.toLowerCase()).toBe(ANVIL_ADDRESS.toLowerCase());
  });

  it("on-chain processVow accepts the encoded vow and returns original event data", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/${TEST_CHAIN_ID}/${Number(eventBlockNumber)}/${eventLogIndex}`
    );
    const body = (await res.json()) as any;
    const { witness } = body;

    const vowHex = encodeVow([
      {
        witness: {
          chainId: witness.chainId as string,
          rootBlockNumber: witness.rootBlockNumber,
          proof: witness.proof as Hex[],
          signature: witness.signature as Hex,
          event: {
            emitter: witness.event.emitter as Address,
            topics: witness.event.topics as Hex[],
            data: witness.event.data as Hex,
          },
        },
        signerIndex: 1, // Anvil key #0 is registered at index 1
      },
    ]);

    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(TEST_RPC_URL),
    });

    const result = (await publicClient.readContract({
      address: addresses.mockVowLib,
      abi: mockVowLibAbi,
      functionName: "processVow",
      args: [addresses.witnessDirectory, vowHex],
    })) as [bigint, bigint, Address, Hex[], Hex];

    const [retChainId, , retEmitter, retTopics, retData] = result;

    expect(retChainId).toBe(caip2ToNumericChainId(TEST_CHAIN_ID));
    expect(retEmitter.toLowerCase()).toBe(
      (witness.event.emitter as string).toLowerCase()
    );
    expect(retTopics.length).toBe((witness.event.topics as Hex[]).length);
    for (let i = 0; i < retTopics.length; i++) {
      expect(retTopics[i]!.toLowerCase()).toBe(
        (witness.event.topics as Hex[])[i]!.toLowerCase()
      );
    }
    expect(retData.toLowerCase()).toBe((witness.event.data as string).toLowerCase());
  });

  it("returns 404 for a non-existent logIndex in the indexed block", async () => {
    const res = await fetch(
      `${BASE_URL}/witness/${TEST_CHAIN_ID}/${Number(eventBlockNumber)}/9999`
    );
    expect(res.status).toBe(404);
  });
});
