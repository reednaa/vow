import { createSolanaRpc, address } from "@solana/kit";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const ANCHOR_MAGIC = "Program data: ";

async function main() {
  console.log(`Connecting to ${RPC_URL}`);
  const rpc = createSolanaRpc(RPC_URL);

  const slot = await rpc.getSlot().send();
  console.log(`Current slot: ${slot}`);

  // Fetch one block with base64 to inspect inner instruction structure
  const targetSlot = slot - BigInt(50);
  console.log(`\nFetching slot ${targetSlot} with base64 encoding...`);
  const block = await rpc
    .getBlock(targetSlot, {
      encoding: "base64",
      maxSupportedTransactionVersion: 0,
      transactionDetails: "full",
      rewards: false,
    })
    .send();

  if (!block) { console.log("Block not found"); return; }

  console.log(`Block has ${block.transactions.length} txs`);

  // Walk through txs to find self-CPI patterns (emit_cpi!)
  let foundCandidates = 0;
  for (const tx of block.transactions) {
    const meta = tx.meta as any;
    const message = (tx as any).transaction?.message;
    if (!meta?.innerInstructions || !message) continue;

    // Build account key lookup: static accounts + loaded addresses = full list
    const staticAccts = message.accountKeys || [];
    const loadedWritable = meta.loadedAddresses?.writable || [];
    const loadedReadonly = meta.loadedAddresses?.readonly || [];
    const allAccts = [...staticAccts, ...loadedWritable, ...loadedReadonly];

    // Get the programId for each top-level instruction
    const parentPrograms: (string | null)[] = message.instructions.map((ix: any) => {
      if (ix.programIdIndex != null && allAccts[ix.programIdIndex]) {
        return allAccts[ix.programIdIndex];
      }
      return null;
    });

    for (const inner of meta.innerInstructions) {
      const parentIxIndex = inner.index;
      const parentProgram = parentPrograms[parentIxIndex];
      if (!parentProgram) continue;

      for (const ix of inner.instructions) {
        // Resolve programId for this inner instruction
        const innerProgram = ix.programIdIndex != null ? allAccts[ix.programIdIndex] : null;

        // Self-CPI check: does the inner instruction call the same program?
        if (innerProgram === parentProgram && ix.data) {
          foundCandidates++;
          if (foundCandidates <= 3) {
            try {
              const dataBytes = Buffer.from(ix.data, "base64");
              console.log(`\n  Self-CPI candidate #${foundCandidates}:`);
              console.log(`    Program: ${parentProgram}`);
              console.log(`    Data hex: ${dataBytes.toString("hex").slice(0, 80)}`);
              console.log(`    Discriminator (8B): ${dataBytes.toString("hex").slice(0, 16)}`);
              console.log(`    Data length: ${dataBytes.length} bytes`);
              // Check if this looks like an Anchor event:
              // Anchor event discriminator is sha256("event:EventName")[..8]
              // Instruction data for a self-CPI event: discriminator(8B) + event_data
              // First 8 bytes are the Anchor discriminator
              const discHex = dataBytes.toString("hex").slice(0, 16);
              console.log(`    Likely Anchor event? ${dataBytes.length >= 8 ? 'yes (has discriminator)' : 'no (<8 bytes)'}`);
            } catch { /* skip */ }
          }
        }
      }
    }
    if (foundCandidates >= 3) break;
  }

  console.log(`\nTotal self-CPI candidates found: ${foundCandidates}`);

  // Also count log-based events for comparison
  let logEvents = 0;
  for (const tx of block.transactions) {
    const meta = tx.meta as any;
    if (meta?.logMessages) {
      for (const msg of meta.logMessages) {
        if (msg.startsWith(ANCHOR_MAGIC)) logEvents++;
      }
    }
  }
  console.log(`emit!() events (logMessages): ${logEvents}`);

  console.log(`\n=== Conclusion ===`);
  if (foundCandidates === 0) {
    console.log(`emit_cpi!() is not widely adopted on mainnet yet.`);
    console.log(`It requires Anchor >= 0.30 + event-cpi feature + #[event_cpi] attribute.`);
    console.log(`Most programs use emit!() (logMessages-based) events.`);
    console.log(``);
    console.log(`For witness service: plan for both approaches, but emit!() parsing`);
    console.log(`from logMessages with CPI stack tracking is the practical default.`);
    console.log(`emit_cpi!() support should be added as an optimization path — when`);
    console.log(`events are in innerInstructions, skip CPI stack tracking entirely.`);
  } else {
    console.log(`emit_cpi!() IS used on mainnet — ${foundCandidates} self-CPI events found.`);
  }
}

main().catch(err => {
  console.error("FATAL:", err.message ?? err);
  process.exit(1);
});
