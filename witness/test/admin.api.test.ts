import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SignJWT } from "jose";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { createDb, closeDb } from "../src/db/client";
import {
  chains,
  indexedBlocks,
  indexedEvents,
  rpcs,
  solanaIndexedEvents,
  solanaIndexedSlots,
} from "../src/db/schema";
import { createAdminApiPlugin } from "../src/api/admin/api";
import { normalizeChainId } from "../src/core/chain-utils";

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";
const JWT_SECRET = "test-secret-for-admin-api";
const SOLANA_CHAIN_ALIAS = "solana:devnet";
const SOLANA_CHAIN_ID = normalizeChainId(SOLANA_CHAIN_ALIAS);
const RPC_URL = "http://stub.admin.rpc";

let db: ReturnType<typeof createDb>;
let app: Elysia;
let authToken: string;
let originalFetch: typeof fetch;

async function sign(secret: string, payload: object = { sub: "admin" }) {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .sign(key);
}

function makeRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", `adminToken=${authToken}`);
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function cleanupChain() {
  await db.delete(solanaIndexedEvents).where(eq(solanaIndexedEvents.chainId, SOLANA_CHAIN_ID));
  await db.delete(solanaIndexedSlots).where(eq(solanaIndexedSlots.chainId, SOLANA_CHAIN_ID));
  await db.delete(indexedEvents).where(eq(indexedEvents.chainId, SOLANA_CHAIN_ID));
  await db.delete(indexedBlocks).where(eq(indexedBlocks.chainId, SOLANA_CHAIN_ID));
  await db.delete(rpcs).where(eq(rpcs.chainId, SOLANA_CHAIN_ID));
  await db.delete(chains).where(eq(chains.chainId, SOLANA_CHAIN_ID));
}

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  app = new Elysia().use(createAdminApiPlugin(db, JWT_SECRET));
  authToken = await sign(JWT_SECRET);
  originalFetch = globalThis.fetch;
});

beforeEach(async () => {
  await cleanupChain();
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(RPC_URL)) {
      return originalFetch(input, init);
    }

    const body = await request.json() as {
      id: string | number | null;
      method: string;
    };
    if (body.method === "getSlot") {
      return Response.json({ jsonrpc: "2.0", id: body.id, result: 777 });
    }
    if (body.method === "eth_blockNumber") {
      return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x2a" });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "Method not found" },
    });
  };
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await cleanupChain();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await closeDb();
});

describe("Admin API chain management", () => {
  it("canonicalizes Solana aliases on insert", async () => {
    const response = await app.handle(
      makeRequest("/admin/api/chains", {
        method: "POST",
        body: JSON.stringify({ chainId: SOLANA_CHAIN_ALIAS }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, chainId: SOLANA_CHAIN_ID });

    const [storedChain] = await db
      .select()
      .from(chains)
      .where(eq(chains.chainId, SOLANA_CHAIN_ID));
    expect(storedChain?.chainId).toBe(SOLANA_CHAIN_ID);
  });

  it("detects duplicates against the canonical Solana chain ID", async () => {
    await app.handle(
      makeRequest("/admin/api/chains", {
        method: "POST",
        body: JSON.stringify({ chainId: SOLANA_CHAIN_ALIAS }),
      })
    );

    const response = await app.handle(
      makeRequest("/admin/api/chains", {
        method: "POST",
        body: JSON.stringify({ chainId: SOLANA_CHAIN_ID }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: `Chain ${SOLANA_CHAIN_ID} already configured`,
    });
  });

  it("validates Solana RPCs with getSlot and stores them on the canonical chain", async () => {
    await db.insert(chains).values({ chainId: SOLANA_CHAIN_ID });

    const response = await app.handle(
      makeRequest(`/admin/api/chains/${SOLANA_CHAIN_ALIAS}/rpcs`, {
        method: "POST",
        body: JSON.stringify({ url: RPC_URL }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("number");
    expect(body.blockNumber).toBe("777");

    const storedRpcs = await db.select().from(rpcs).where(eq(rpcs.chainId, SOLANA_CHAIN_ID));
    expect(storedRpcs).toHaveLength(1);
    expect(storedRpcs[0]!.url).toBe(RPC_URL);
  });

  it("deletes Solana indexed rows before removing the chain", async () => {
    await db.insert(chains).values({ chainId: SOLANA_CHAIN_ID });
    await db.insert(rpcs).values({
      chainId: SOLANA_CHAIN_ID,
      url: RPC_URL,
    });
    await db.insert(solanaIndexedSlots).values({
      chainId: SOLANA_CHAIN_ID,
      slot: 9001n,
      blockhash: "solana-delete-blockhash",
      merkleRoot: "0x" + "11".repeat(32),
      latestSlotAtIndex: 9002n,
      signature: "0x" + "22".repeat(64),
    });
    await db.insert(solanaIndexedEvents).values({
      chainId: SOLANA_CHAIN_ID,
      slot: 9001n,
      txSignature: "delete-solana-tx",
      eventIndexLocal: 0,
      eventIndex: 0,
      treeIndex: 0,
      leafHash: "0x" + "33".repeat(32),
      canonicalBytes: "deadbeef",
    });

    const response = await app.handle(
      makeRequest(`/admin/api/chains/${SOLANA_CHAIN_ALIAS}`, { method: "DELETE" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const remainingChain = await db
      .select()
      .from(chains)
      .where(eq(chains.chainId, SOLANA_CHAIN_ID));
    const remainingSlots = await db
      .select()
      .from(solanaIndexedSlots)
      .where(eq(solanaIndexedSlots.chainId, SOLANA_CHAIN_ID));
    const remainingEvents = await db
      .select()
      .from(solanaIndexedEvents)
      .where(eq(solanaIndexedEvents.chainId, SOLANA_CHAIN_ID));

    expect(remainingChain).toHaveLength(0);
    expect(remainingSlots).toHaveLength(0);
    expect(remainingEvents).toHaveLength(0);
  });
});
