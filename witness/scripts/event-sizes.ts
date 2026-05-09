import { createSolanaRpc } from "@solana/kit";
import bs58 from "bs58";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const SLOTS_TO_SAMPLE = 5;

const EVENT_IX_TAG = new Uint8Array([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);
const IX_TAG_LEN = 8;
const DISC_LEN = 8;

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
  const rpc = createSolanaRpc(RPC_URL);
  const slot = await rpc.getSlot().send();

  const allEvents: Array<{ slot: number; program: string; discriminator: string; totalBytes: number; eventBytes: number }> = [];

  for (let i = 0; i < SLOTS_TO_SAMPLE; i++) {
    const targetSlot = slot - BigInt(i * 100 + 50);
    if (i > 0) await new Promise(r => setTimeout(r, 2000));

    const block = await rpc.getBlock(targetSlot, {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
      transactionDetails: "full",
      rewards: false,
    }).send();

    if (!block) continue;

    const slotEvents: typeof allEvents = [];

    for (const tx of block.transactions) {
      const meta = tx.meta as any;
      const message = (tx as any).transaction?.message;
      if (!meta?.innerInstructions || !message) continue;

      const staticAccts = message.accountKeys || [];
      const writable = meta.loadedAddresses?.writable || [];
      const readonly = meta.loadedAddresses?.readonly || [];
      const allAccts = [...staticAccts, ...writable, ...readonly];

      const parentPrograms: (string | null)[] = (message.instructions || []).map((ix: any) =>
        ix.programIdIndex != null ? allAccts[ix.programIdIndex] ?? null : null
      );

      for (const inner of meta.innerInstructions) {
        const parentProgram = parentPrograms[inner.index];
        if (!parentProgram) continue;

        for (const ix of inner.instructions) {
          const innerProgram = ix.programIdIndex != null ? allAccts[ix.programIdIndex] : null;
          if (!innerProgram || innerProgram !== parentProgram || !ix.data) continue;
          if (!tagMatches(ix.data)) continue;

          const decoded = bs58.decode(ix.data);
          const eventBytes = decoded.length - IX_TAG_LEN; // subtract EVENT_IX_TAG
          const discriminator = Buffer.from(decoded.subarray(IX_TAG_LEN, IX_TAG_LEN + DISC_LEN)).toString("hex");

          slotEvents.push({
            slot: Number(targetSlot),
            program: innerProgram.slice(0, 8) + "...",
            discriminator,
            totalBytes: decoded.length,
            eventBytes,
          });
        }
      }
    }

    allEvents.push(...slotEvents);
    const sizes = slotEvents.map(e => e.eventBytes);
    console.log(
      "slot " + targetSlot +
      " | events: " + slotEvents.length +
      " | avg event bytes: " + (sizes.length ? (sizes.reduce((a,b)=>a+b,0) / sizes.length).toFixed(0) : "-") +
      " | min: " + (sizes.length ? Math.min(...sizes) : "-") +
      " | max: " + (sizes.length ? Math.max(...sizes) : "-")
    );
  }

  // Per-slot distribution
  console.log("\n--- Size distribution (event bytes, excl 8B EVENT_IX_TAG) ---");
  const sizes = allEvents.map(e => e.eventBytes);
  sizes.sort((a, b) => a - b);
  const avg = sizes.reduce((a,b)=>a+b,0) / sizes.length;
  const p50 = sizes[Math.floor(sizes.length * 0.5)]!;
  const p90 = sizes[Math.floor(sizes.length * 0.9)]!;
  const p99 = sizes[Math.floor(sizes.length * 0.99)]!;
  const pMax = sizes[sizes.length - 1]!;

  console.log("  count:     " + sizes.length);
  console.log("  avg:       " + avg.toFixed(0) + " bytes");
  console.log("  median:    " + p50 + " bytes");
  console.log("  p90:       " + p90 + " bytes");
  console.log("  p99:       " + p99 + " bytes");
  console.log("  max:       " + pMax + " bytes");

  // Bucket distribution
  const buckets: Record<string, number> = {};
  for (const s of sizes) {
    const bucket = Math.floor(s / 50) * 50;
    const key = bucket + "-" + (bucket + 49);
    buckets[key] = (buckets[key] || 0) + 1;
  }
  console.log("\n  buckets:");
  for (const [range, count] of Object.entries(buckets).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    const bar = "#".repeat(Math.ceil(count / Math.max(1, sizes.length) * 60));
    console.log("    " + range.padStart(10) + ": " + String(count).padStart(4) + " " + bar);
  }

  // Largest events detail
  console.log("\n--- Largest events (top 5) ---");
  const sorted = [...allEvents].sort((a, b) => b.eventBytes - a.eventBytes);
  for (const e of sorted.slice(0, 5)) {
    console.log("  " + e.eventBytes + " bytes | slot " + e.slot + " | program " + e.program + " | disc " + e.discriminator.slice(0, 16));
  }
}

main().catch(err => { console.error("FATAL:", err.message ?? err); process.exit(1); });
