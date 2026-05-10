import { toHex } from "viem";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client.ts";
import { rpcs as rpcTable } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { createSolanaRpcClient, extractEmitCpiEvents } from "../src/rpc/solana-client.ts";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://vow:vow@localhost:5433/vow_witness";
const CHAIN_ID = 2;
const TX_SIGNATURE = "4A6i2xxoDzF7vvEzfcVeDoHW4NJSAAbYAQvapmgDL6VzX6cHGvUbkqnvZW8ko4XRgZghu3ydJ56fgdn9rGTpiwCZ";
const EVENT_LOCAL = 0;

async function main() {
  const db = createDb(DATABASE_URL);
  const rows = await db.select({ url: rpcTable.url }).from(rpcTable).where(eq(rpcTable.chainId, CHAIN_ID));
  const urls = rows.map(r => r.url);
  console.log(`RPCs: ${urls.length}`);
  urls.forEach((u, i) => console.log(`  RPC ${i}: ${u}`));
  console.log(`\nTx: ${TX_SIGNATURE}\n`);

  // 1. Resolve the slot via getTransaction from both RPCs
  const clients = urls.map((u) => createSolanaRpcClient(u));
  console.log("=== Step 1: Resolve slot ===");
  const txs = await Promise.all(clients.map(async (c, i) => {
    try {
      const tx = await c.getTransaction(TX_SIGNATURE);
      console.log(`  RPC ${i}: slot=${tx?.slot ?? "NOT FOUND"}, blockhash=${tx?.blockhash ?? "N/A"}`);
      return tx;
    } catch (err: any) {
      console.log(`  RPC ${i}: ERROR — ${err.message}`);
      return null;
    }
  }));
  console.log();

  const slot = txs[0]?.slot ?? txs[1]?.slot;
  if (!slot) {
    console.log("Transaction not found on any RPC. Exiting.");
    process.exit(1);
  }
  console.log(`Resolved slot: ${slot}\n`);

  // 2. Fetch blocks and look for this tx
  console.log("=== Step 2: Fetch blocks and find events ===");
  const blocks = await Promise.all(clients.map(async (c, i) => {
    try {
      const block = await c.getBlock(slot);
      const txInBlock = block.transactions.find(
        (tx) => tx.transaction?.signatures?.[0] === TX_SIGNATURE,
      );
      console.log(`  RPC ${i}: ${block.transactions.length} txs, target tx at index=${txInBlock ? block.transactions.indexOf(txInBlock) : "NOT FOUND"}`);
      return block;
    } catch (err: any) {
      console.log(`  RPC ${i}: ERROR fetching block — ${err.message}`);
      return null;
    }
  }));
  console.log();

  // 3. Extract events from target tx in each block
  console.log("=== Step 3: Events in target transaction ===");
  for (const [bi, block] of blocks.entries()) {
    if (!block) { console.log(`  RPC ${bi}: no block data\n`); continue; }
    const events = extractEmitCpiEvents(block);
    const txEvents = events.filter((e) => e.txSignature === TX_SIGNATURE);
    console.log(`  RPC ${bi}: total events in block=${events.length}, in target tx=${txEvents.length}`);
    for (const e of txEvents) {
      const marker = e.eventIndexLocal === EVENT_LOCAL ? " ← TARGET" : "";
      console.log(`    local=${e.eventIndexLocal} global=${e.eventIndex} leafHash=${e.leafHash}${marker}`);
    }
    console.log();
  }

  // 4. Compare target event
  console.log("=== Step 4: Compare event local=0 ===");
  const events0 = blocks.map((block) => {
    if (!block) return null;
    const events = extractEmitCpiEvents(block);
    return events.find((e) => e.txSignature === TX_SIGNATURE && e.eventIndexLocal === EVENT_LOCAL) ?? null;
  });

  for (const [i, e] of events0.entries()) {
    if (!e) {
      console.log(`  RPC ${i}: Event local=0 NOT FOUND`);
      continue;
    }
    console.log(`  RPC ${i}:`);
    console.log(`    leafHash:       ${e.leafHash}`);
    console.log(`    canonicalBytes: ${toHex(e.canonicalBytes)}`);
  }

  const match = events0[0] && events0[1] && events0[0].leafHash === events0[1].leafHash;
  console.log(`\n  Leaf hashes: ${match ? "MATCH ✓" : "DIFFER ✗"}`);

  if (!match && events0[0] && events0[1]) {
    console.log(`  RPC 0 leafHash: ${events0[0].leafHash}`);
    console.log(`  RPC 1 leafHash: ${events0[1].leafHash}`);
  }

  // 5. Check if it's already in the DB
  console.log("\n=== Step 5: Check DB ===");
  const existingRows = await db.execute(
    sql`SELECT slot, event_index, leaf_hash, created_at
        FROM solana_indexed_events
        WHERE chain_id = ${CHAIN_ID}
          AND tx_signature = ${TX_SIGNATURE}
          AND event_index_local = ${EVENT_LOCAL}`,
  );
  const existing = existingRows[0] ?? null;
  if (existing) {
    console.log("  Already indexed:", existing);
  } else {
    console.log("  Not yet indexed in DB");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err.message ?? err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
