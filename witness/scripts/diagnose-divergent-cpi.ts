import bs58 from "bs58";
import { toHex } from "viem";
import { createDb } from "../src/db/client.ts";
import { rpcs } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import {
  createSolanaRpcClient,
  extractEmitCpiEvents,
  type SolanaBlock,
  type SolanaTxResponse,
} from "../src/rpc/solana-client.ts";
import {
  decodeSolanaEvent,
  isEmitCpi,
  extractEmitCpiEncoding,
  EVENT_IX_TAG,
} from "../src/core/solana-encoding.ts";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://vow:vow@localhost:5433/vow_witness";

const CHAIN_ID = process.env.CHAIN_ID || "solana:mainnet";
const SLOT = 418695462n;
const TX_SIGNATURE =
  "3RCdw4WDfpn53o9bDjXRyPpgSFeZL1mHvjSogAbg6hGidUVrL4JuMXQptPj4eTnJGQEXJPXsyCFuyBRSa5H7AVSc";

// --- Helpers ---

function hex(arr: Uint8Array, len?: number): string {
  const s = toHex(arr);
  return len ? s.slice(0, 2 + len * 2) : s;
}

function arrEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function showByteDiff(
  label: string,
  a: Uint8Array,
  b: Uint8Array,
  offset: number,
  n: number,
) {
  const lines: string[] = [];
  lines.push(`  ${label}:`);
  const aHex = toHex(a.slice(offset, offset + n));
  const bHex = toHex(b.slice(offset, offset + n));
  if (aHex === bHex) {
    lines.push(`    MATCH ✓ (${aHex})`);
  } else {
    lines.push(`    RPC 0=${aHex}`);
    lines.push(`    RPC 1=${bHex}`);
    lines.push(`    DIFF ✗`);
  }
  return lines.join("\n");
}

// --- Main ---

async function main() {
  console.log("=== Solana CPI Divergence Diagnoser ===");
  console.log(`Slot: ${SLOT}`);
  console.log(`Tx:   ${TX_SIGNATURE}`);
  console.log();

  // 1. Connect to DB and get RPC URLs
  console.log("--- Step 1: Fetching RPC config from DB ---");
  const db = createDb(DATABASE_URL);
  const rpcRows = await db
    .select({ url: rpcs.url })
    .from(rpcs)
    .where(eq(rpcs.chainId, CHAIN_ID));

  const urls = rpcRows.map((r) => r.url);
  console.log(`Found ${urls.length} RPC(s) for chain_id=${CHAIN_ID}:`);
  urls.forEach((u, i) => console.log(`  RPC ${i}: ${u}`));
  if (urls.length < 2) {
    console.log("ERROR: Need at least 2 RPCs to compare!");
    process.exit(1);
  }
  console.log();

  // 2. Create clients
  const clients = urls.map((url) => createSolanaRpcClient(url));

  // 3. Fetch raw blocks
  console.log("--- Step 2: Fetching blocks ---");
  let blocks: SolanaBlock[];
  try {
    blocks = await Promise.all(
      clients.map((c, i) =>
        c
          .getBlock(SLOT)
          .then((b) => {
            console.log(`  RPC ${i}: got block, ${b.transactions?.length ?? 0} txs`);
            return b;
          })
          .catch((e) => {
            console.log(`  RPC ${i}: ERROR fetching block — ${e.message}`);
            throw e;
          }),
      ),
    );
  } catch {
    console.log("Failed to fetch blocks. Exiting.");
    process.exit(1);
  }
  console.log();

  // 4. Fetch raw transactions
  console.log("--- Step 3: Fetching transactions ---");
  const txs: Array<SolanaTxResponse | null> = await Promise.all(
    clients.map((c, i) =>
      c
        .getTransaction(TX_SIGNATURE)
        .then((tx) => {
          const innerGrps = tx.meta?.innerInstructions?.length ?? 0;
          console.log(`  RPC ${i}: got tx, slot=${tx.slot}, innerIxGroups=${innerGrps}`);
          return tx;
        })
        .catch((e) => {
          console.log(`  RPC ${i}: ERROR fetching tx — ${e.message}`);
          return null;
        }),
    ),
  );
  if (txs.every((tx) => tx === null)) {
    console.log("Failed to fetch transactions. Continuing with block data only.");
  }
  console.log();

  // ============================================================
  // LEVEL 1: Block comparison
  // ============================================================
  console.log("=== Level 1: Block Comparison ===");
  if (blocks[0]!.blockhash === blocks[1]!.blockhash) {
    console.log(`Block hash:   MATCH ✓ (${blocks[0]!.blockhash})`);
  } else {
    console.log(
      `Block hash:   RPC 0=${blocks[0]!.blockhash}, RPC 1=${blocks[1]!.blockhash} DIFF ✗`,
    );
  }

  const txCounts = blocks.map((b) => b.transactions?.length ?? 0);
  console.log(`Tx count:     RPC 0=${txCounts[0]}, RPC 1=${txCounts[1]}`);
  if (txCounts[0] !== txCounts[1]) {
    console.log(`              MISMATCH (${txCounts[0]} vs ${txCounts[1]})`);
    const maxCount = Math.min(txCounts[0]!, txCounts[1]!);
    // Find first differing tx signature
    for (let i = 0; i < maxCount; i++) {
      const s0 = blocks[0]!.transactions[i]!.transaction?.signatures?.[0];
      const s1 = blocks[1]!.transactions[i]!.transaction?.signatures?.[0];
      if (s0 !== s1) {
        console.log(`  First different tx at index ${i}:`);
        console.log(`    RPC 0=${s0}`);
        console.log(`    RPC 1=${s1}`);
        break;
      }
    }
  } else {
    console.log("              (same tx count)");
  }

  // Find target tx in each block
  const targetIndices = blocks.map((b) =>
    b.transactions?.findIndex(
      (tx) => tx.transaction?.signatures?.[0] === TX_SIGNATURE,
    ),
  );
  console.log(
    `Target tx:    RPC 0=index ${targetIndices[0] ?? "NOT FOUND"}, RPC 1=index ${targetIndices[1] ?? "NOT FOUND"}`,
  );

  // Compare first 5 and last 5 tx signatures
  for (const [bi, block] of blocks.entries()) {
    const sigs = block.transactions?.map(
      (tx) => tx.transaction?.signatures?.[0] ?? "(none)",
    );
    if (sigs) {
      console.log(`  RPC ${bi} first 5 sigs:`, sigs.slice(0, 5));
      if (sigs.length > 10)
        console.log(`  RPC ${bi} last 5 sigs:`, sigs.slice(-5));
    }
  }
  console.log();

  // ============================================================
  // LEVEL 2: Transaction comparison (from getTransaction)
  // ============================================================
  console.log("=== Level 2: Transaction Comparison (getTransaction) ===");
  for (const [i, tx] of txs.entries()) {
    if (!tx) {
      console.log(`  RPC ${i}: NO TRANSACTION DATA`);
      continue;
    }
    const msg = tx.transaction?.message;
    const meta = tx.meta;
    const topIxCount = msg?.instructions?.length ?? 0;
    const innerGrps = meta?.innerInstructions ?? [];
    let totalInnerIxs = 0;
    for (const g of innerGrps) {
      totalInnerIxs += g.instructions?.length ?? 0;
    }
    console.log(`  RPC ${i}:`);
    console.log(`    slot:              ${tx.slot}`);
    console.log(
      `    accountKeys:        ${msg?.accountKeys?.length ?? 0} entries`,
    );
    console.log(`    top-level ix:       ${topIxCount}`);
    console.log(
      `    innerIx groups:     ${innerGrps.length} (total inner ix: ${totalInnerIxs})`,
    );
    // Show account keys
    const accts = msg?.accountKeys;
    if (accts) {
      console.log(`    accountKeys[0..2]:`, accts.slice(0, 3));
      const last = accts.length - 1;
      if (last > 2)
        console.log(
          `    accountKeys[${last - 1}..${last}]:`,
          accts.slice(last - 1),
        );
    }
    // Show programIdIndex for each top-level instruction
    const topIxs = msg?.instructions;
    if (topIxs) {
      for (const [j, ix] of topIxs.entries()) {
        const prog =
          ix.programIdIndex != null && accts?.[ix.programIdIndex]
            ? accts[ix.programIdIndex]
            : "(unknown)";
        console.log(
          `    top-ix[${j}]: progIdIdx=${ix.programIdIndex} prog=${prog}`,
        );
      }
    }
    // Show inner instruction group structure
    for (const [j, g] of innerGrps.entries()) {
      console.log(
        `    innerGroup[${j}]: index=${g.index}, instructions=${g.instructions?.length ?? 0}`,
      );
    }
  }
  console.log();

  // ============================================================
  // LEVEL 3: extractEmitCpiEvents comparison
  // ============================================================
  console.log("=== Level 3: extractEmitCpiEvents Comparison ===");
  const eventsPerRpc = blocks.map((b) => extractEmitCpiEvents(b));
  console.log(
    `Event count:  RPC 0=${eventsPerRpc[0]!.length}, RPC 1=${eventsPerRpc[1]!.length}`,
  );

  if (eventsPerRpc[0]!.length !== eventsPerRpc[1]!.length) {
    console.log("  Event count MISMATCH — RPCs returned different numbers of CPI events!");
  }

  const maxEvents = Math.min(
    eventsPerRpc[0]!.length,
    eventsPerRpc[1]!.length,
  );
  let firstDivergence = -1;
  for (let j = 0; j < maxEvents; j++) {
    const e0 = eventsPerRpc[0]![j]!;
    const e1 = eventsPerRpc[1]![j]!;
    const match = e0.leafHash === e1.leafHash;
    if (!match && firstDivergence === -1) firstDivergence = j;
    const marker = match ? "✓" : "✗ DIVERGENCE";
    console.log(
      `  Event ${j}: RPC 0=${e0.leafHash.slice(0, 14)}... RPC 1=${e1.leafHash.slice(0, 14)}... ${marker}`,
    );
    if (!match && j >= 5) {
      console.log(`    ... (showing only first diverging event, skipping others)`);
      break;
    }
  }
  console.log();

  // Deep-dive on divergent event
  if (firstDivergence >= 0) {
    const j = firstDivergence;
    const e0 = eventsPerRpc[0]![j]!;
    const e1 = eventsPerRpc[1]![j]!;

    console.log(`=== Deep Dive: Event ${j} ===`);
    console.log(`  RPC 0 leafHash:        ${e0.leafHash}`);
    console.log(`  RPC 1 leafHash:        ${e1.leafHash}`);
    console.log(
      `  RPC 0 txSignature:     ${e0.txSignature}`,
    );
    console.log(
      `  RPC 1 txSignature:     ${e1.txSignature}`,
    );
    console.log(
      `  RPC 0 eventIndexLocal: ${e0.eventIndexLocal}`,
    );
    console.log(
      `  RPC 1 eventIndexLocal: ${e1.eventIndexLocal}`,
    );
    console.log();

    // Decode canonical bytes from both
    const dec0 = decodeSolanaEvent(e0.canonicalBytes);
    const dec1 = decodeSolanaEvent(e1.canonicalBytes);

    console.log("--- Canonical Bytes Decoded ---");
    console.log(`  canonicalBytes total length: RPC 0=${e0.canonicalBytes.length}, RPC 1=${e1.canonicalBytes.length}`);

    // programId (bytes 0-31)
    console.log(
      showByteDiff("programId (32 bytes)", dec0.programId, dec1.programId, 0, 32),
    );

    // discriminator (bytes 32-39)
    console.log(
      showByteDiff("discriminator (8 bytes)", dec0.discriminator, dec1.discriminator, 0, 8),
    );

    // data
    console.log(
      `  data:`,
    );
    console.log(`    RPC 0 length=${dec0.data.length}, hex=${hex(dec0.data, 64)}`);
    console.log(`    RPC 1 length=${dec1.data.length}, hex=${hex(dec1.data, 64)}`);
    if (dec0.data.length !== dec1.data.length) {
      console.log(`    length DIFF ✗ (${dec0.data.length} vs ${dec1.data.length})`);
    }
    console.log();

    // Full canonicalBytes side-by-side
    console.log("--- Full canonicalBytes hex ---");
    console.log(
      `  RPC 0 (${e0.canonicalBytes.length}B): ${hex(e0.canonicalBytes)}`,
    );
    console.log(
      `  RPC 1 (${e1.canonicalBytes.length}B): ${hex(e1.canonicalBytes)}`,
    );
    console.log();
  }

  // ============================================================
  // LEVEL 4: Pinpoint the raw inner instruction
  // ============================================================
  console.log("=== Level 4: Pinpoint Raw Inner Instruction ===");

  // Manually re-walk the blocks to find event at position `firstDivergence`
  if (firstDivergence >= 0) {
    for (const [bi, block] of blocks.entries()) {
      console.log(`\n-- Walking RPC ${bi} block for event ${firstDivergence} --`);

      let globalIdx = 0;
      let found = false;

      for (let txIdx = 0; txIdx < block.transactions.length && !found; txIdx++) {
        const tx = block.transactions[txIdx]!;
        const sigs = tx.transaction?.signatures;
        const txSig = sigs?.[0] ?? "";
        const msg = tx.transaction?.message;
        if (!msg) continue;

        const staticAccts = msg.accountKeys;
        const topIxs = msg.instructions;
        const meta = tx.meta;
        const innerIxGroups = meta?.innerInstructions;

        const parentPrograms: (string | null)[] = topIxs.map((ix) => {
          if (ix.programIdIndex != null && staticAccts[ix.programIdIndex]) {
            return staticAccts[ix.programIdIndex]!;
          }
          return null;
        });

        for (let ixIdx = 0; ixIdx < topIxs.length && !found; ixIdx++) {
          const parentProgram = parentPrograms[ixIdx];
          if (!parentProgram) continue;
          if (!innerIxGroups) continue;

          const group = innerIxGroups.find((g) => g.index === ixIdx);
          if (!group) continue;

          for (let innerIdx = 0; innerIdx < group.instructions.length; innerIdx++) {
            const innerIx = group.instructions[innerIdx]!;
            const innerProgram =
              innerIx.programIdIndex != null
                ? staticAccts[innerIx.programIdIndex] ?? null
                : null;

            if (
              innerProgram &&
              innerIx.data &&
              isEmitCpi(innerIx.data, innerProgram, parentProgram)
            ) {
              if (globalIdx === firstDivergence) {
                found = true;
                console.log(`  Located at: txIndex=${txIdx}, topIxIndex=${ixIdx}, innerIxIndex=${innerIdx}`);
                console.log(`  txSignature: ${txSig}`);
                console.log(`  Parent program ID: ${parentProgram}`);
                console.log(`  Inner program ID:  ${innerProgram}`);
                console.log(`  Self-CPI check:    ${innerProgram === parentProgram ? "PASS ✓" : "FAIL ✗"}`);

                // Raw inner instruction data (base58)
                console.log(`\n  Raw innerIx.data (base58):`);
                console.log(`    ${innerIx.data}`);

                // Decode
                const rawBytes = bs58.decode(innerIx.data);
                const tag = rawBytes.slice(0, 8);
                const disc = rawBytes.slice(8, 16);
                const eventData = rawBytes.slice(16);

                console.log(`\n  Decoded innerIx.data (${rawBytes.length} bytes):`);
                console.log(
                  `    EVENT_IX_TAG (bytes 0-7):     ${toHex(tag)}`,
                );
                const tagMatch =
                  tag.length === 8 &&
                  EVENT_IX_TAG.every((v, k) => v === tag[k]);
                console.log(`    Tag matches anchor:event?    ${tagMatch ? "YES ✓" : "NO ✗"}`);
                console.log(
                  `    Discriminator (bytes 8-15):   ${toHex(disc)}`,
                );
                console.log(
                  `    Event data (bytes 16+):        ${toHex(eventData)}`,
                );
                console.log(
                  `    Event data length:             ${eventData.length} bytes`,
                );

                // Also show the program ID as base58
                console.log(
                  `\n  programId (base58):             ${innerProgram}`,
                );

                // Compare with extracted encoding
                const programIdBytes = bs58.decode(innerProgram);
                const encoding = extractEmitCpiEncoding(
                  innerIx.data,
                  programIdBytes,
                );
                console.log(
                  `  leafHash (from this extraction): ${encoding.leafHash}`,
                );
                console.log(
                  `  canonicalBytes length:           ${encoding.canonicalBytes.length}`,
                );
              }
              globalIdx++;
            }
          }
        }
      }

      if (!found) {
        console.log(`  Event ${firstDivergence} NOT FOUND in RPC ${bi} block walk!`);
      }
    }
  }
  console.log();

  // ============================================================
  // LEVEL 5: Account key comparison
  // ============================================================
  console.log("=== Level 5: Account Key Comparison (target tx) ===");

  // Use the blocks to get the target transaction's account keys
  for (const [bi, block] of blocks.entries()) {
    const targetTx = block.transactions?.find(
      (tx) => tx.transaction?.signatures?.[0] === TX_SIGNATURE,
    );
    if (!targetTx) {
      console.log(`  RPC ${bi}: Target tx NOT FOUND in block`);
      continue;
    }
    const accts = targetTx.transaction?.message?.accountKeys ?? [];
    console.log(`  RPC ${bi}: ${accts.length} account keys`);
    for (let k = 0; k < accts.length; k++) {
      console.log(`    [${k}] ${accts[k]}`);
    }
  }
  console.log();

  // Also compare from getTransaction if available
  console.log("--- Account Keys from getTransaction ---");
  for (const [i, tx] of txs.entries()) {
    if (!tx) {
      console.log(`  RPC ${i}: NO DATA`);
      continue;
    }
    const accts = tx.transaction?.message?.accountKeys ?? [];
    console.log(`  RPC ${i}: ${accts.length} account keys`);
    for (let k = 0; k < accts.length; k++) {
      console.log(`    [${k}] ${accts[k]}`);
    }
  }
  console.log();

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("=== Summary ===");

  if (firstDivergence >= 0) {
    const e0 = eventsPerRpc[0]![firstDivergence]!;
    const e1 = eventsPerRpc[1]![firstDivergence]!;
    console.log(
      `Event ${firstDivergence} canonicalBytes differ starting at byte 32 (discriminator).`,
    );
    console.log(`RPC 0 leafHash: ${e0.leafHash}`);
    console.log(`RPC 1 leafHash: ${e1.leafHash}`);

    if (txCounts[0] !== txCounts[1]) {
      console.log(
        `Transaction counts differ: ${txCounts[0]} vs ${txCounts[1]} — RPCs see different blocks.`,
      );
      console.log("This is a reorg or RPC sync issue.");
    } else if (
      targetIndices[0] !== targetIndices[1]
    ) {
      console.log(
        `Target tx appears at different indices: ${targetIndices[0]} vs ${targetIndices[1]} — different tx ordering.`,
      );
    } else {
      console.log(
        "Tx counts and indices match — divergence is in inner instruction data content.",
      );
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err.message ?? err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
