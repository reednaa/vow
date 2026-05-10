import bs58 from "bs58";
import { toHex } from "viem";
import { createDb } from "../src/db/client.ts";
import { rpcs as rpcTable } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { createSolanaRpcClient, extractEmitCpiEvents } from "../src/rpc/solana-client.ts";
import { isEmitCpi, extractEmitCpiEncoding, decodeSolanaEvent } from "../src/core/solana-encoding.ts";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://vow:vow@localhost:5433/vow_witness";
const CHAIN_ID = 2;
const SLOT = 418777600n;
const FAILING_TX = "4TmHb6vpR5Lqt4NFYUZcmhVX213pTzkguG5MaH6zpdvDXwGxHEJr5GD3811j2C1rHBiugUwSCE7Hske13NoeXyAS";

async function main() {
  const db = createDb(DATABASE_URL);
  const rows = await db.select({ url: rpcTable.url }).from(rpcTable).where(eq(rpcTable.chainId, CHAIN_ID));
  const clients = rows.map((r) => createSolanaRpcClient(r.url));

  console.log(`Slot: ${SLOT}`);
  console.log(`Failing tx: ${FAILING_TX}\n`);

  const blocks = await Promise.all(clients.map((c) => c.getBlock(SLOT)));

  for (const [bi, block] of blocks.entries()) {
    const tx = block.transactions.find(
      (tx) => tx.transaction?.signatures?.[0] === FAILING_TX,
    );
    if (!tx) { console.log(`RPC ${bi}: TX NOT FOUND in block\n`); continue; }

    const msg = tx.transaction?.message;
    const staticAccts = msg?.accountKeys ?? [];
    const topIxs = msg?.instructions ?? [];
    const innerIxGroups = tx.meta?.innerInstructions;

    console.log(`=== RPC ${bi}: tx at block index ${block.transactions.indexOf(tx)} ===`);
    console.log(`Top-level ix: ${topIxs.length}`);
    console.log(`Inner ix groups: ${innerIxGroups?.length ?? 0}`);

    const parentPrograms: (string | null)[] = topIxs.map((ix) => {
      if (ix.programIdIndex != null && staticAccts[ix.programIdIndex])
        return staticAccts[ix.programIdIndex]!;
      return null;
    });

    let totalCpi = 0;
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

        console.log(`  Event local=${totalCpi}:`);
        console.log(`    topIxIdx=${ixIdx} innerIxPos=${group.instructions.indexOf(innerIx)}`);
        console.log(`    parentProgram:  ${parentProgram}`);
        console.log(`    innerProgram:   ${innerProgram}`);
        console.log(`    leafHash:       ${enc.leafHash}`);
        console.log(`    innerIx.data:   ${innerIx.data}`);
        console.log(`    canonicalBytes: ${toHex(enc.canonicalBytes)}`);

        const dec = decodeSolanaEvent(enc.canonicalBytes);
        console.log(`    decoded:`);
        console.log(`      programId:     ${toHex(dec.programId)}`);
        console.log(`      discriminator: ${toHex(dec.discriminator)}`);
        console.log(`      data (${dec.data.length}B): ${toHex(dec.data)}`);
        console.log();
        totalCpi++;
      }
    }
    console.log(`  Total CPI events: ${totalCpi}\n`);
  }

  // Compare
  const events0 = extractEmitCpiEvents(blocks[0]!).filter(e => e.txSignature === FAILING_TX);
  const events1 = extractEmitCpiEvents(blocks[1]!).filter(e => e.txSignature === FAILING_TX);

  console.log("=== Cross-RPC comparison ===");
  if (events0.length !== events1.length) {
    console.log(`Event count differs: RPC 0=${events0.length}, RPC 1=${events1.length}`);
  }
  for (let i = 0; i < Math.max(events0.length, events1.length); i++) {
    const e0 = events0[i];
    const e1 = events1[i];
    if (!e0) { console.log(`  local=${i}: RPC 0 MISSING, RPC 1 leafHash=${e1?.leafHash}`); continue; }
    if (!e1) { console.log(`  local=${i}: RPC 0 leafHash=${e0.leafHash}, RPC 1 MISSING`); continue; }
    const m = e0.leafHash === e1.leafHash ? "✓" : "✗";
    console.log(`  local=${i}: RPC 0=${e0.leafHash} vs RPC 1=${e1.leafHash} ${m}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err.message ?? err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
