import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SignJWT } from "jose";
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

import { getSolanaLatestSlots, getSolanaLatestSlot } from "../src/db/queries";

const DATABASE_URL = "postgresql://vow:vow@localhost:5433/vow_witness";
const JWT_SECRET = "test-secret-for-admin-api";
const SOLANA_CHAIN_ALIAS = "solana:8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR";
const SOLANA_CHAIN_ID = normalizeChainId(SOLANA_CHAIN_ALIAS);
const RPC_URL = "http://stub.admin.rpc";

let db: ReturnType<typeof createDb>;
let app: ReturnType<typeof createAdminApiPlugin>;
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
  app = createAdminApiPlugin(db, JWT_SECRET);
  authToken = await sign(JWT_SECRET);
  originalFetch = globalThis.fetch;
});

beforeEach(async () => {
  await cleanupChain();
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
    },
    { preconnect: originalFetch.preconnect },
  );
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

  it("inserts chain with custom confirmations value", async () => {
    const response = await app.handle(
      makeRequest("/admin/api/chains", {
        method: "POST",
        body: JSON.stringify({ chainId: SOLANA_CHAIN_ID, confirmations: 5 }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);

    const [storedChain] = await db
      .select()
      .from(chains)
      .where(eq(chains.chainId, SOLANA_CHAIN_ID));
    expect(storedChain!.confirmations).toBe(5);
  });

  it("defaults confirmations to 12 when not provided", async () => {
    const response = await app.handle(
      makeRequest("/admin/api/chains", {
        method: "POST",
        body: JSON.stringify({ chainId: SOLANA_CHAIN_ID }),
      })
    );
    expect(response.status).toBe(200);
    const [storedChain] = await db
      .select()
      .from(chains)
      .where(eq(chains.chainId, SOLANA_CHAIN_ID));
    expect(storedChain!.confirmations).toBe(12);
  });

  it("PATCH /chains/:chainId updates confirmations", async () => {
    await db.insert(chains).values({ chainId: SOLANA_CHAIN_ID, confirmations: 12 });

    const response = await app.handle(
      makeRequest(`/admin/api/chains/${SOLANA_CHAIN_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ confirmations: 3 }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.confirmations).toBe(3);

    const [storedChain] = await db
      .select()
      .from(chains)
      .where(eq(chains.chainId, SOLANA_CHAIN_ID));
    expect(storedChain!.confirmations).toBe(3);
  });

  it("PATCH /chains/:chainId returns 404 for unknown chain", async () => {
    // Use a valid Solana genesis hash that isn't seeded in the test DB
    const nonexistentId = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    const response = await app.handle(
      makeRequest(`/admin/api/chains/${nonexistentId}`, {
        method: "PATCH",
        body: JSON.stringify({ confirmations: 5 }),
      })
    );
    expect(response.status).toBe(404);
  });

  it("GET /chains/:chainId/blocks returns Solana indexed slots", async () => {
    await db.insert(chains).values({ chainId: SOLANA_CHAIN_ID });
    await db.insert(solanaIndexedSlots).values({
      chainId: SOLANA_CHAIN_ID,
      slot: 100n,
      blockhash: "solana-blockhash",
      merkleRoot: "0x" + "ff".repeat(32),
      latestSlotAtIndex: 105n,
      signature: "0x" + "ee".repeat(64),
    });

    const response = await app.handle(
      makeRequest(`/admin/api/chains/${SOLANA_CHAIN_ALIAS}/blocks`)
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].blockNumber).toBe("100");
    expect(body[0].blockHash).toBe("solana-blockhash");
    expect(body[0].latestBlockAtIndex).toBe("105");
  });

  it("GET /stats includes Solana slot and event counts", async () => {
    await db.insert(chains).values({ chainId: SOLANA_CHAIN_ID });
    await db.insert(solanaIndexedSlots).values({
      chainId: SOLANA_CHAIN_ID,
      slot: 200n,
      blockhash: "hash",
      merkleRoot: "0x" + "11".repeat(32),
      latestSlotAtIndex: 250n,
      signature: "0x" + "22".repeat(64),
    });
    await db.insert(solanaIndexedEvents).values({
      chainId: SOLANA_CHAIN_ID,
      slot: 200n,
      txSignature: "stats-solana-tx",
      eventIndexLocal: 0,
      eventIndex: 0,
      treeIndex: 0,
      leafHash: "0x" + "33".repeat(32),
      canonicalBytes: "beef",
    });
    await db.insert(solanaIndexedEvents).values({
      chainId: SOLANA_CHAIN_ID,
      slot: 200n,
      txSignature: "stats-solana-tx",
      eventIndexLocal: 1,
      eventIndex: 1,
      treeIndex: 1,
      leafHash: "0x" + "44".repeat(32),
      canonicalBytes: "cafe",
    });

    const response = await app.handle(makeRequest("/admin/api/stats"));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(Number(body.indexedBlocks)).toBeGreaterThanOrEqual(1);
    expect(Number(body.indexedEvents)).toBeGreaterThanOrEqual(2);
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

// --- db/queries tests (reuses admin DB) ---------------------------------------

const QUERY_CHAIN_1 = "solana:query-chain-111111111111111111111111111111111111";
const QUERY_CHAIN_2 = "solana:query-chain-222222222222222222222222222222222222";

describe("db/queries (getSolanaLatestSlots / getSolanaLatestSlot)", () => {
  beforeAll(async () => {
    await db.delete(solanaIndexedSlots).where(eq(solanaIndexedSlots.chainId, QUERY_CHAIN_1));
    await db.delete(solanaIndexedSlots).where(eq(solanaIndexedSlots.chainId, QUERY_CHAIN_2));
    await db.insert(chains).values([{ chainId: QUERY_CHAIN_1 }, { chainId: QUERY_CHAIN_2 }]);
    await db.insert(solanaIndexedSlots).values([
      { chainId: QUERY_CHAIN_1, slot: 100n, blockhash: "h1", merkleRoot: "0x00", latestSlotAtIndex: 150n, signature: "0x00" },
      { chainId: QUERY_CHAIN_1, slot: 200n, blockhash: "h2", merkleRoot: "0x00", latestSlotAtIndex: 250n, signature: "0x00" },
      { chainId: QUERY_CHAIN_2, slot: 500n, blockhash: "h3", merkleRoot: "0x00", latestSlotAtIndex: 550n, signature: "0x00" },
    ]);
  });

  afterAll(async () => {
    await db.delete(solanaIndexedSlots).where(eq(solanaIndexedSlots.chainId, QUERY_CHAIN_1));
    await db.delete(solanaIndexedSlots).where(eq(solanaIndexedSlots.chainId, QUERY_CHAIN_2));
    await db.delete(chains).where(eq(chains.chainId, QUERY_CHAIN_1));
    await db.delete(chains).where(eq(chains.chainId, QUERY_CHAIN_2));
  });

  it("returns empty map for empty input", async () => {
    const result = await getSolanaLatestSlots(db, []);
    expect(result.size).toBe(0);
  });

  it("returns latest slot per chain", async () => {
    const result = await getSolanaLatestSlots(db, [QUERY_CHAIN_1, QUERY_CHAIN_2]);
    expect(result.size).toBe(2);
    expect(result.get(QUERY_CHAIN_1)).toBe(250n);
    expect(result.get(QUERY_CHAIN_2)).toBe(550n);
  });

  it("getSolanaLatestSlot returns max for single chain", async () => {
    const result = await getSolanaLatestSlot(db, QUERY_CHAIN_1);
    expect(result).toBe(250n);
  });

  it("getSolanaLatestSlot returns null when no slots exist", async () => {
    const result = await getSolanaLatestSlot(db, "solana:nonexistent-chain-000000000000000");
    expect(result).toBeNull();
  });
});
