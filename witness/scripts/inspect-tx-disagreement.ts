import bs58 from "bs58";
import { toHex } from "viem";
import { createDb } from "../src/db/client.ts";
import { rpcs } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { createSolanaRpcClient, extractEmitCpiEvents } from "../src/rpc/solana-client.ts";
import { isEmitCpi, extractEmitCpiEncoding, decodeSolanaEvent } from "../src/core/solana-encoding.ts";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://vow:vow@localhost:5433/vow_witness";
const CHAIN_ID = 2;
const SLOT = 418695462n;
const TX_SIGNATURE = "qZwgDVogHuQffKzXsoy5cajJwRt3jJe9qEDBn6Bj1QhjeaXruRh9V6ujeDVPigwtDhNYfSV5n9bqkT1JgyPPo35";

async function main() {
  const db = createDb(DATABASE_URL);
  const rows = await db.select({ url: rpcs.url }).from(rpcs).where(eq(rpcs.chainId, CHAIN_ID));
  const clients = rows.map((r) => createSolanaRpcClient(r.url));

  console.log(`Slot: ${SLOT}`);
  console.log(`Tx:   ${TX_SIGNATURE}\n`);

  const blocks = await Promise.all(clients.map((c) => c.getBlock(SLOT)));

  for (const [bi, block] of blocks.entries()) {
    const tx = block.transactions.find(
      (tx) => tx.transaction?.signatures?.[0] === TX_SIGNATURE,
    );
    if (!tx) {
      console.log(`RPC ${bi}: TX NOT FOUND in block`);
      continue;
    }

    const msg = tx.transaction?.message;
    const staticAccts = msg?.accountKeys ?? [];
    const topIxs = msg?.instructions ?? [];
    const innerIxGroups = tx.meta?.innerInstructions;

    const parentPrograms: (string | null)[] = topIxs.map((ix) => {
      if (ix.programIdIndex != null && staticAccts[ix.programIdIndex])
        return staticAccts[ix.programIdIndex]!;
      return null;
    });

    let eventsFound = 0;
    for (let ixIdx = 0; ixIdx < topIxs.length; ixIdx++) {
      const parentProgram = parentPrograms[ixIdx];
      if (!parentProgram) continue;
      if (!innerIxGroups) continue;
      const group = innerIxGroups.find((g) => g.index === ixIdx);
      if (!group) continue;

      for (const innerIx of group.instructions) {
        const innerProgram =
          innerIx.programIdIndex != null
            ? staticAccts[innerIx.programIdIndex] ?? null
            : null;
        if (!innerProgram || !innerIx.data) continue;
        if (!isEmitCpi(innerIx.data, innerProgram, parentProgram)) continue;

        const programIdBytes = bs58.decode(innerProgram);
        const enc = extractEmitCpiEncoding(innerIx.data, programIdBytes);

        console.log(`RPC ${bi} event local=${eventsFound}:`);
        console.log(`  txIndex in block:     ${block.transactions.indexOf(tx)}`);
        console.log(`  topIxIdx=${ixIdx}  innerIxIdx=${group.instructions.indexOf(innerIx)}`);
        console.log(`  parentProgram:        ${parentProgram}`);
        console.log(`  innerProgram:         ${innerProgram}`);
        console.log(`  leafHash:             ${enc.leafHash}`);
        console.log(`  canonicalBytes (${enc.canonicalBytes.length}B): ${toHex(enc.canonicalBytes)}`);
        console.log(`  innerIx.data base58:  ${innerIx.data}`);

        const rawBytes = bs58.decode(innerIx.data);
        console.log(`  decoded (${rawBytes.length}B):`);
        console.log(`    [0..8]  EVENT_IX_TAG:  ${toHex(rawBytes.slice(0, 8))}`);
        console.log(`    [8..16] discriminator: ${toHex(rawBytes.slice(8, 16))}`);
        console.log(`    [16..]  borsh data:    ${toHex(rawBytes.slice(16))}`);

        // Decode canonical for comparison display
        const dec = decodeSolanaEvent(enc.canonicalBytes);
        console.log(`  canonical decoded:`);
        console.log(`    programId:     ${toHex(dec.programId)}`);
        console.log(`    discriminator: ${toHex(dec.discriminator)}`);
        console.log(`    data:          ${toHex(dec.data)}`);
        console.log();
        eventsFound++;
      }
    }
    if (eventsFound === 0) console.log(`RPC ${bi}: NO emit_cpi events found\n`);
    else console.log(`RPC ${bi}: ${eventsFound} emit_cpi event(s) total\n`);
  }

  // Also run extractEmitCpiEvents and find the matching tx
  console.log("=== extractEmitCpiEvents for target tx ===");
  for (const [bi, block] of blocks.entries()) {
    const events = extractEmitCpiEvents(block).filter((e) => e.txSignature === TX_SIGNATURE);
    for (const e of events) {
      console.log(`RPC ${bi} local=${e.eventIndexLocal} global=${e.eventIndex} leafHash=${e.leafHash}`);
      console.log(`  canonicalBytes: ${toHex(e.canonicalBytes)}`);
    }
    console.log();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err.message ?? err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
