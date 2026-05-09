import { createSolanaRpc } from "@solana/kit";
import bs58 from "bs58";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const SAMPLE_SLOTS = 8;
const DELAY_MS = 3000;
const SKIP_SLOTS = 100;

// sha256("anchor:event")[0..8] — Anchor's fixed tag for emit_cpi! instruction data
const EVENT_IX_TAG = new Uint8Array([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);
const ANCHOR_MAGIC = "Program data: ";

function tagMatches(data: string): boolean {
  try {
    const bytes = bs58.decode(data);
    if (bytes.length < 8) return false;
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== EVENT_IX_TAG[i]!) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`Connecting to ${RPC_URL}`);
  const rpc = createSolanaRpc(RPC_URL);

  const slot = await rpc.getSlot().send();
  console.log(`Current slot: ${slot}\n`);

  let totalTxs = 0;
  let totalTopIxs = 0;
  let totalInnerIxs = 0;
  let totalLogEvents = 0;
  let totalCpiEvents = 0;
  let slotsWithCpi = 0;
  let detailsShown = 0;

  console.log(
    "slot".padStart(12),
    "txs".padStart(6),
    "top-ix".padStart(7),
    "inner-ix".padStart(9),
    "emit!(log)".padStart(11),
    "emit_cpi!".padStart(10),
  );

  for (let i = 0; i < SAMPLE_SLOTS; i++) {
    const targetSlot = slot - BigInt(i * SKIP_SLOTS);
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));

    try {
      const block = await rpc
        .getBlock(targetSlot, {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
          transactionDetails: "full",
          rewards: false,
        })
        .send();

      if (!block) continue;

      let slotTopIxs = 0;
      let slotInnerIxs = 0;
      let slotLogEvents = 0;
      let slotCpiEvents = 0;

      for (const tx of block.transactions) {
        const meta = tx.meta as any;
        const message = (tx as any).transaction?.message;
        if (!message) continue;

        // Count top-level instructions
        const topIxs = message.instructions || [];
        slotTopIxs += topIxs.length;

        // Count emit!() events from logMessages
        if (meta?.logMessages) {
          for (const msg of meta.logMessages) {
            if (msg.startsWith(ANCHOR_MAGIC)) slotLogEvents++;
          }
        }

        // Build account key lookup for programId resolution
        const staticAccts = message.accountKeys || [];
        const loadedWritable = meta?.loadedAddresses?.writable || [];
        const loadedReadonly = meta?.loadedAddresses?.readonly || [];
        const allAccts = [...staticAccts, ...loadedWritable, ...loadedReadonly];

        // Resolve programId for each top-level instruction
        const parentPrograms: (string | null)[] = topIxs.map((ix: any) => {
          if (ix.programIdIndex != null && allAccts[ix.programIdIndex]) {
            return allAccts[ix.programIdIndex];
          }
          return null;
        });

        // Inspect inner instructions for emit_cpi!()
        if (meta?.innerInstructions) {
          for (const inner of meta.innerInstructions) {
            const parentIxIndex = inner.index;
            const parentProgram = parentPrograms[parentIxIndex];
            if (!parentProgram) continue;

            for (const ix of inner.instructions) {
              slotInnerIxs++;

              // Resolve programId for this inner instruction
              const innerProgram =
                ix.programIdIndex != null ? allAccts[ix.programIdIndex] : null;
              if (!innerProgram || !ix.data) continue;

              // Signal 1: Self-CPI — inner program == parent program
              if (innerProgram !== parentProgram) continue;

              // Signal 2: EVENT_IX_TAG discriminator (bs58-encoded data)
              if (tagMatches(ix.data)) {
                slotCpiEvents++;
                if (detailsShown < 3) {
                  detailsShown++;
                  const dataBytes = bs58.decode(ix.data);
                  const buf = Buffer.from(dataBytes);
                  console.log("");
                  console.log("  emit_cpi! in slot " + targetSlot + ":");
                  console.log("    Program:           " + innerProgram);
                  console.log("    EVENT_IX_TAG:      " + buf.subarray(0, 8).toString("hex"));
                  console.log("    Event discriminator:" + buf.subarray(8, 16).toString("hex"));
                  console.log("    Data length:       " + dataBytes.length + " bytes");
                }
              }
            }
          }
        }
      }

      totalTxs += block.transactions.length;
      totalTopIxs += slotTopIxs;
      totalInnerIxs += slotInnerIxs;
      totalLogEvents += slotLogEvents;
      totalCpiEvents += slotCpiEvents;
      if (slotCpiEvents > 0) slotsWithCpi++;

      console.log(
        String(targetSlot).padStart(12),
        String(block.transactions.length).padStart(6),
        String(slotTopIxs).padStart(7),
        String(slotInnerIxs).padStart(9),
        String(slotLogEvents).padStart(11),
        String(slotCpiEvents).padStart(10),
      );
    } catch (err: any) {
      console.log(
        String(targetSlot).padStart(12),
        "ERROR".padStart(6),
        err.message?.slice(0, 30).padEnd(7),
      );
    }
  }

  console.log("");
  console.log("=== Averages (" + (totalTxs > 0 ? SAMPLE_SLOTS : 0) + " slots) ===");
  if (totalTxs > 0) {
    console.log(`  tx/slot:        ${(totalTxs / SAMPLE_SLOTS).toFixed(0)}`);
    console.log(`  top-ix/slot:    ${(totalTopIxs / SAMPLE_SLOTS).toFixed(0)}`);
    console.log(`  inner-ix/slot:  ${(totalInnerIxs / SAMPLE_SLOTS).toFixed(0)}`);
    console.log(`  emit!(log)/slot:     ${(totalLogEvents / SAMPLE_SLOTS).toFixed(1)}`);
    console.log(`  emit_cpi!/slot:      ${(totalCpiEvents / SAMPLE_SLOTS).toFixed(1)}`);
    console.log(`  slots with emit_cpi!: ${slotsWithCpi}/${SAMPLE_SLOTS}`);

    // Instruction composition
    console.log("");
    console.log("=== Instruction Composition ===");
    const cpiPct = totalInnerIxs > 0 ? (totalCpiEvents / totalInnerIxs * 100).toFixed(3) : "0";
    const innerPct = (totalInnerIxs / (totalTopIxs + totalInnerIxs) * 100).toFixed(1);
    const selfCpiRatio = totalTopIxs > 0 ? (totalCpiEvents / totalTopIxs).toFixed(4) : "0";
    console.log("  % emit_cpi! of inner-ix: " + cpiPct + "%");
    console.log("  % inner-ix of total-ix: " + innerPct + "%");
    console.log("  self-CPI ratio:         " + selfCpiRatio);

    // Witness feasibility
    console.log("");
    console.log("=== Witness Feasibility ===");
    const totalEvents = (totalLogEvents + totalCpiEvents) / SAMPLE_SLOTS;
    const cpiShare = (totalCpiEvents / Math.max(1, totalLogEvents + totalCpiEvents) * 100).toFixed(1);
    console.log("  Total events/slot:  ~" + totalEvents);
    console.log("  emit_cpi! share:    " + cpiShare + "%");
    if (totalCpiEvents === 0) {
      console.log("  emit_cpi!() is NOT used on sampled mainnet slots.");
      console.log("  Primary path: logMessages parsing with CPI stack tracking.");
    } else {
      console.log("  emit_cpi!() IS used. Dual-path detection recommended.");
    }
  }
}

main().catch(err => {
  console.error("FATAL:", err.message ?? err);
  process.exit(1);
});
