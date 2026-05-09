import { createSolanaRpc } from "@solana/kit";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const SAMPLE_SLOTS = 10;
const DELAY_MS = 2500;
const SKIP_SLOTS = 50;
const ANCHOR_MAGIC = "Program data: ";

function parseLogEvents(logMessages: readonly string[]) {
  const events: string[] = [];
  for (const msg of logMessages) {
    if (msg.startsWith(ANCHOR_MAGIC)) {
      events.push(msg.slice(ANCHOR_MAGIC.length));
    }
  }
  return events;
}

/**
 * Extract events from innerInstructions.
 * emit_cpi!() does a self-CPI — the program invokes itself with the event
 * data encoded in the instruction data. These appear as inner instructions
 * where programId matches the original instruction's programId.
 */
function parseCpiEvents(
  innerInstructions: readonly {
    index: number;
    instructions: readonly Record<string, unknown>[];
  }[] | undefined,
  parentProgramId: string | null
) {
  if (!innerInstructions || !parentProgramId) return [];
  const events: Array<{ programId: string; data: string }> = [];
  for (const inner of innerInstructions) {
    for (const ix of inner.instructions) {
      const ixProgramId = (ix as any).programId ?? (ix as any).program_id;
      const ixData = (ix as any).data ?? (ix as any).data_base64;
      // Self-CPI: program calls itself with event data
      if (ixProgramId === parentProgramId && ixData) {
        events.push({ programId: ixProgramId, data: ixData });
      }
    }
  }
  return events;
}

async function main() {
  console.log(`Connecting to ${RPC_URL}`);
  const rpc = createSolanaRpc(RPC_URL);

  const version = await rpc.getVersion().send();
  console.log(`Node version: ${version["solana-core"]}`);

  const slot = await rpc.getSlot().send();
  console.log(`Current slot: ${slot}`);

  // Sample blocks
  console.log(`\n=== Comparing emit!() vs emit_cpi!() event extraction ===`);
  console.log(`Sampling ${SAMPLE_SLOTS} slots\n`);

  let totalLogEvents = 0;
  let totalCpiEvents = 0;
  let totalTxs = 0;

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

      let slotLogEvents = 0;
      let slotCpiEvents = 0;

      for (const tx of block.transactions) {
        const logMessages = tx.meta?.logMessages;
        const innerIxs = tx.meta?.innerInstructions;
        const txMsg = tx.transaction?.message;

        // emit!() events: from logMessages
        if (logMessages) {
          slotLogEvents += parseLogEvents(logMessages).length;
        }

        // emit_cpi!() events: from innerInstructions (self-CPI)
        if (innerIxs && txMsg?.instructions) {
          for (const ix of txMsg.instructions) {
            const ixProgramId = (ix as any).programId ?? null;
            const cpiEvents = parseCpiEvents(innerIxs, ixProgramId);
            slotCpiEvents += cpiEvents.length;
          }
        }
      }

      totalLogEvents += slotLogEvents;
      totalCpiEvents += slotCpiEvents;
      totalTxs += block.transactions.length;

      const overlap = slotLogEvents > 0 && slotCpiEvents > 0 ? "both" : slotCpiEvents > 0 ? "CPI-only" : slotLogEvents > 0 ? "log-only" : "none";
      console.log(
        `  Slot ${targetSlot}: ${block.transactions.length} txs | log: ${slotLogEvents} | cpi: ${slotCpiEvents} | ${overlap}`
      );

      // Show detailed CPI event example from first tx with CPI events
      if (slotCpiEvents > 0 && i === 0) {
        for (const tx of block.transactions) {
          const innerIxs = tx.meta?.innerInstructions;
          const txMsg = tx.transaction?.message;
          if (!innerIxs || !txMsg?.instructions) continue;

          for (const parentIx of txMsg.instructions) {
            const parentProgramId = (parentIx as any).programId;
            const events = parseCpiEvents(innerIxs, parentProgramId);
            if (events.length > 0) {
              console.log(`\n  Example emit_cpi!() event (slot ${targetSlot}):`);
              console.log(`    Program: ${parentProgramId}`);
              console.log(`    Self-CPI instruction data (first 80 hex):`);
              try {
                const bytes = Buffer.from(events[0]!.data, "base64");
                console.log(`    ${bytes.toString("hex").slice(0, 80)}`);
                console.log(`    Discriminator (first 8 bytes): ${bytes.toString("hex").slice(0, 16)}`);
              } catch {
                console.log(`    (could not decode)`);
              }
              break;
            }
          }
        }
      }
    } catch (err: any) {
      console.log(`  Slot ${targetSlot}: error - ${err.message?.slice(0, 60)}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total txs:        ${totalTxs}`);
  console.log(`emit!() events:   ${totalLogEvents} (from logMessages)`);
  console.log(`emit_cpi!() evts: ${totalCpiEvents} (from innerInstructions)`);
  if (totalTxs > 0) {
    console.log(`log/tx:           ${(totalLogEvents / totalTxs).toFixed(3)}`);
    console.log(`cpi/tx:           ${(totalCpiEvents / totalTxs).toFixed(3)}`);
  }

  console.log(`\n=== Witness Implications ===`);
  console.log(`emit!() approach:`);
  console.log(`  - Events in logMessages as "Program data: <base64>"`);
  console.log(`  - Must track CPI stack to determine emitting program`);
  console.log(`  - Subject to log truncation by RPC providers`);
  console.log(`  - No explicit programId → fragile for canonical encoding`);
  console.log(``);
  console.log(`emit_cpi!() approach:`);
  console.log(`  - Events in innerInstructions as self-CPI instruction data`);
  console.log(`  - Explicit programId (the instruction's programId field)`);
  console.log(`  - Structured: programId + discriminator + event data`);
  console.log(`  - NOT subject to log truncation`);
  console.log(`  - Direct mapping to canonical encoding: programId(32B) | discriminator(8B) | eventData`);
  console.log(`  - Only works if program uses emit_cpi!() + #[event_cpi]`);

  // Test: compare json vs base64 encoding for inner instruction inspection
  console.log(`\n=== Inspecting innerInstruction format (json vs base64) ===`);
  const testSlot = slot - BigInt(100);
  try {
    // json encoding
    const blockJson = await rpc
      .getBlock(testSlot, {
        encoding: "json",
        maxSupportedTransactionVersion: 0,
        transactionDetails: "full",
        rewards: false,
      })
      .send();

    if (blockJson) {
      for (const tx of blockJson.transactions.slice(0, 20)) {
        const inner = tx.meta?.innerInstructions;
        if (inner && inner.length > 0) {
          const firstInner = inner[0]!;
          console.log(`\n  JSON innerInstruction:`);
          console.log(`    index: ${(firstInner as any).index}`);
          console.log(`    instructions count: ${firstInner.instructions.length}`);
          const sampleIx = firstInner.instructions[0]!;
          console.log(`    sample instruction keys: ${Object.keys(sampleIx as object).join(", ")}`);
          console.log(`    sample instruction values:`);
          for (const [key, val] of Object.entries(sampleIx as object)) {
            const v = typeof val === "string" && val.length > 80 ? val.slice(0, 77) + "..." : String(val);
            console.log(`      ${key}: ${v}`);
          }
          break;
        }
      }
    }

    // base64 encoding
    const block64 = await rpc
      .getBlock(testSlot, {
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
        transactionDetails: "full",
        rewards: false,
      })
      .send();

    if (block64) {
      for (const tx of block64.transactions.slice(0, 10)) {
        const meta = tx.meta as any;
        if (meta?.innerInstructions?.length > 0) {
          const firstInner = meta.innerInstructions[0];
          console.log(`\n  base64 innerInstruction:`);
          console.log(`    index: ${firstInner.index}`);
          console.log(`    instructions count: ${firstInner.instructions.length}`);
          const sampleIx = firstInner.instructions[0];
          console.log(`    sample instruction keys: ${Object.keys(sampleIx).join(", ")}`);
          for (const [key, val] of Object.entries(sampleIx)) {
            const v = typeof val === "string" && val.length > 80 ? val.slice(0, 77) + "..." : String(val);
            console.log(`      ${key}: ${v}`);
          }
          // For base64, show the decoded event data if it's a self-cpi
          if (sampleIx.data && sampleIx.programIdIndex != null) {
            const accts = meta.loadedAddresses?.writable?.concat(meta.loadedAddresses?.readonly || []) || [];
            console.log(`    programIdIndex: ${sampleIx.programIdIndex}, accounts count: ${sampleIx.accounts?.length}`);
            console.log(`    accounts: ${JSON.stringify(sampleIx.accounts?.slice(0, 6))}`);
            try {
              const dataBytes = Buffer.from(sampleIx.data, "base64");
              console.log(`    data hex (first 32): ${dataBytes.toString("hex").slice(0, 32)}`);
              console.log(`    potential discriminator: ${dataBytes.toString("hex").slice(0, 16)}`);
            } catch { /* ignore */ }
          }
          break;
        }
      }
    }
  } catch (err: any) {
    console.log(`  Inner inspection error: ${err.message?.slice(0, 80)}`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message ?? err);
  process.exit(1);
});
