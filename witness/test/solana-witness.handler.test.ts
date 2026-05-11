import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import type { Hex } from "viem";
import { createDb, closeDb } from "../src/db/client";
import {
  chains,
  rpcs,
  solanaIndexedEvents,
  solanaIndexedSlots,
} from "../src/db/schema";
import { createSolanaWitnessController } from "../src/api/solana-witness.handler";
import {
  caip2ToNumericChainId,
  normalizeChainId,
} from "../src/core/chain-utils";
import { createEnvSigner } from "../src/core/signing";
import {
  computeSolanaLeafHash,
  encodeSolanaEvent,
} from "../src/core/solana-encoding";

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";
const TEST_CHAIN_ID = "solana:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const TEST_CHAIN_ALIAS = TEST_CHAIN_ID;
const RPC_URL = "http://stub.solana.rpc";
const SIGNER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SIGNER = createEnvSigner(SIGNER_KEY);

let db: ReturnType<typeof createDb>;
let originalFetch: typeof fetch;
const txSlots = new Map<string, bigint | null>();

function makeApp(addJob: ReturnType<typeof createAddJobSpy>) {
  return new Elysia().onError(({ error, code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: error.message };
    }
    set.status = 500;
    return { error: String(error) };
  }).use(createSolanaWitnessController(db, addJob, SIGNER.address()));
}

function createAddJobSpy() {
  const calls: Array<{ identifier: string; payload: unknown; spec: unknown }> = [];
  const addJob = async (identifier: string, payload?: unknown, spec?: unknown) => {
    calls.push({ identifier, payload, spec });
    return {};
  };
  return Object.assign(addJob, { calls });
}

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`);
}

async function cleanupSolanaChain() {
  await db.delete(solanaIndexedEvents).where(eq(solanaIndexedEvents.chainId, TEST_CHAIN_ID));
  await db.delete(solanaIndexedSlots).where(eq(solanaIndexedSlots.chainId, TEST_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, TEST_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, TEST_CHAIN_ID));
}

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  originalFetch = globalThis.fetch;
});

beforeEach(async () => {
  txSlots.clear();
  await cleanupSolanaChain();
  await db.insert(chains).values({ chainId: TEST_CHAIN_ID });
  globalThis.fetch = Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const request =
        input instanceof Request
          ? new Request(input, init as RequestInit | undefined)
          : new Request(String(input), init as RequestInit | undefined);
      if (!request.url.startsWith(RPC_URL)) {
        return originalFetch(...args);
      }

      const body = await request.json() as {
        id: string | number | null;
        method: string;
        params?: unknown[];
      };
      if (body.method === "getTransaction") {
        const signature = body.params?.[0] as string;
        const slot = txSlots.get(signature) ?? null;
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: slot === null ? null : {
            slot: Number(slot),
            blockhash: "stub-solana-blockhash",
            transaction: {
              signatures: [signature],
              message: { accountKeys: [], instructions: [] },
            },
            meta: null,
          },
        });
      }

      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method not found" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  txSlots.clear();
  await cleanupSolanaChain();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await closeDb();
});

describe("GET /witness/solana", () => {
  it("resolves alias input to the canonical stored chain ID", async () => {
    const slot = 8101n;
    const txSignature = "indexed-solana-tx";
    const programId = new Uint8Array(32).fill(7);
    const discriminator = new Uint8Array(8).fill(3);
    const data = Uint8Array.from([1, 2, 3, 4]);
    const canonicalBytes = encodeSolanaEvent(programId, discriminator, data);
    const leafHash = computeSolanaLeafHash(canonicalBytes);
    const signature = await SIGNER.signVow({
      chainId: caip2ToNumericChainId(TEST_CHAIN_ID),
      rootBlockNumber: slot,
      root: leafHash,
    });

    await db.insert(solanaIndexedSlots).values({
      chainId: TEST_CHAIN_ID,
      slot,
      blockhash: "indexed-blockhash",
      merkleRoot: leafHash,
      latestSlotAtIndex: slot + 5n,
      signature,
    });
    await db.insert(solanaIndexedEvents).values({
      chainId: TEST_CHAIN_ID,
      slot,
      txSignature,
      eventIndexLocal: 0,
      eventIndex: 0,
      treeIndex: 0,
      leafHash,
      canonicalBytes: Buffer.from(canonicalBytes).toString("hex"),
    });

    const app = makeApp(createAddJobSpy());
    const response = await app.handle(
      makeRequest(`/witness/solana/${TEST_CHAIN_ALIAS}/${txSignature}/0`)
    );

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.status).toBe("ready");
    expect(body.witness.chainId).toBe(TEST_CHAIN_ID);
    expect(body.witness.signer.toLowerCase()).toBe(SIGNER.address().toLowerCase());
  });

  it("returns 404 when the slot is indexed but the requested event is absent", async () => {
    const slot = 8102n;
    const txSignature = "missing-event-solana-tx";

    txSlots.set(txSignature, slot);
    await db.insert(rpcs).values({
      chainId: TEST_CHAIN_ID,
      url: RPC_URL,
    });
    await db.insert(solanaIndexedSlots).values({
      chainId: TEST_CHAIN_ID,
      slot,
      blockhash: "indexed-slot-only",
      merkleRoot: ("0x" + "11".repeat(32)) as Hex,
      latestSlotAtIndex: slot + 1n,
      signature: ("0x" + "22".repeat(64)) as Hex,
    });

    const app = makeApp(createAddJobSpy());
    const response = await app.handle(
      makeRequest(`/witness/solana/${TEST_CHAIN_ALIAS}/${txSignature}/0`)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Event not found at this event index",
    });
  });

  it("returns 404 when the transaction cannot be resolved to a slot", async () => {
    const txSignature = "missing-solana-transaction";

    txSlots.set(txSignature, null);
    await db.insert(rpcs).values({
      chainId: TEST_CHAIN_ID,
      url: RPC_URL,
    });

    const app = makeApp(createAddJobSpy());
    const response = await app.handle(
      makeRequest(`/witness/solana/${TEST_CHAIN_ALIAS}/${txSignature}/0`)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Transaction not found" });
  });

  it("returns pending and enqueues indexing for an unindexed slot", async () => {
    const slot = 8103n;
    const txSignature = "pending-solana-transaction";
    const addJob = createAddJobSpy();

    txSlots.set(txSignature, slot);
    await db.insert(rpcs).values({
      chainId: TEST_CHAIN_ID,
      url: RPC_URL,
    });

    const app = makeApp(addJob);
    const response = await app.handle(
      makeRequest(`/witness/solana/${TEST_CHAIN_ALIAS}/${txSignature}/0`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "pending" });
    expect(addJob.calls).toEqual([
      {
        identifier: "index-solana-slot",
        payload: { chainId: TEST_CHAIN_ID, slot: Number(slot) },
        spec: {
          jobKey: `solana-index:${TEST_CHAIN_ID}:${Number(slot)}`,
          maxAttempts: 5,
          priority: 0,
        },
      },
    ]);
  });
});
