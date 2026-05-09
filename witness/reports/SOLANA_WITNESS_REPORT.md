# Solana Witness Service — Exploration Report

> Consolidated findings from Solana mainnet event analysis.
> Intended for agents implementing the Solana witness service.

## Table of Contents

1. [Scripts & Usage](#scripts--usage)
2. [Key Metrics](#key-metrics)
3. [Event Detection](#event-detection)
4. [API Design](#api-design)
5. [Canonical Event Encoding](#canonical-event-encoding)
6. [Proof & Merkle Tree Sizing](#proof--merkle-tree-sizing)
7. [Architecture Deviations from EVM](#architecture-deviations-from-evm)
8. [DB Schema](#db-schema)
9. [Multi-RPC Consistency](#multi-rpc-consistency)
10. [Open Items](#open-items)

---

## Scripts & Usage

All scripts live in `witness/scripts/`. Run with `bun run`.

### `explore-solana-kit.ts`

Tests `@solana/kit` capabilities and counts `emit!()` events from logMessages.

```bash
SOLANA_RPC_URL="https://your-rpc" bun run scripts/explore-solana-kit.ts
```

Outputs: RPC methods available, tx/slot counts, emit!() events/slot, log message structure samples, block sizes.

### `inspect-emit-cpi.ts`

Initial emit_cpi!() detection attempt (self-CPI only, no EVENT_IX_TAG check). **Superseded by `analyze-emit-cpi.ts`.** Kept for reference on inner instruction structure inspection.

### `analyze-emit-cpi.ts`

**Primary analysis script.** Detects emit_cpi!() using both signals (self-CPI + `sha256("anchor:event")[0..8]`). Counts top-level instructions, inner instructions, log events, and CPI events per slot.

```bash
SOLANA_RPC_URL="https://your-rpc" bun run scripts/analyze-emit-cpi.ts
```

Outputs: per-slot table with tx/ix/event counts, averages, instruction composition, emit_cpi! share.

### `event-sizes.ts`

Samples emit_cpi!() event byte sizes across multiple slots. Outputs size distribution, percentiles, and bucket histogram.

```bash
SOLANA_RPC_URL="https://your-rpc" bun run scripts/event-sizes.ts
```

Outputs: per-slot avg/min/max, overall distribution stats, size buckets, top-5 largest events.

### RPC Notes

- Public RPC (`api.mainnet-beta.solana.com`) rate-limits aggressively — scripts use 2-3s delays
- Encoding must be `"json"` (NOT `"base64"`) to access parsed instructions
- Inner instruction `data` field is **base58-encoded**, NOT base64
- Log event data (`Program data:`) is **base64-encoded**

---

## Key Metrics

All numbers from Solana mainnet, sampled across 8-10 slots around slot 418,574,600.

| Metric | Value |
|--------|-------|
| Avg transactions/slot | ~1,200 |
| Avg top-level instructions/slot | ~2,900 |
| Avg inner (CPI) instructions/slot | ~1,600 |
| **Avg emit!() events/slot** | **~125** |
| **Avg emit_cpi!() events/slot** | **~141** |
| **Total events/slot** | **~266** |
| emit_cpi!() share of events | **53%** |
| % of inner-ix that are emit_cpi! | ~8.7% |
| % of txs with events | ~10% |
| Slots with emit_cpi! present | 8/8 |

### Event Byte Sizes

From 1,000 events across 5 slots (sizes are encoded event data bytes, excluding 8-byte EVENT_IX_TAG):

| Stat | Event data | Full canonical (32B programId + 8B disc + eventData) |
|------|-----------|------------------------------------------------------|
| Avg | 245 B | 285 B |
| Median | 188 B | 228 B |
| p90 | 440 B | 480 B |
| p99 | 1,240 B | 1,280 B |
| Max | 1,240 B | 1,280 B |
| Min | 25 B | 65 B |

Bimodal distribution: ~64% in 50–199B range, ~27% in 350–499B range, ~2% at 1,050–1,240B.

---

## Event Detection

### emit_cpi!() — Primary Path

Two definitive signals. Both must be present:

**Signal 1: Self-CPI**
Inner instruction's resolved programId equals its parent instruction's resolved programId.

```typescript
const innerProgram = allAccts[ix.programIdIndex];
const parentProgram = allAccts[parentIx.programIdIndex];
const isSelfCpi = innerProgram === parentProgram;
```

**Signal 2: EVENT_IX_TAG (Magic Discriminator)**

Anchor hardcodes `sha256("anchor:event")[0..8]` at the start of every emit_cpi!() instruction data:

```
e4 45 a5 2e 51 cb 9a 1d
```

Verified against 1,000+ mainnet events — every detection matches.

```typescript
const EVENT_IX_TAG = new Uint8Array([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

function isEmitCpi(innerData: string, innerProgram: string, parentProgram: string): boolean {
  if (innerProgram !== parentProgram) return false;
  const bytes = bs58.decode(innerData); // inner ix data is base58
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== EVENT_IX_TAG[i]) return false;
  }
  return true;
}
```

### Instruction Data Layout

```
[EVENT_IX_TAG: 8 bytes] [event_discriminator: 8 bytes] [borsh event payload: N bytes]
```

- `EVENT_IX_TAG` = `sha256("anchor:event")[0..8]` — constant, always the same
- `event_discriminator` = `sha256("event:EventName")[0..8]` — varies per event type
- Data is **base58-encoded** in the JSON RPC response (`ix.data` field)

### emit!() — Secondary Path

For programs not using emit_cpi! (~47% of events):

Events appear in `tx.meta.logMessages` as `"Program data: <base64>"` strings.

**CPI stack tracking required.** Parse log messages sequentially:
```
"Program <pubkey> invoke [N]"  → push programId to stack
"Program data: <base64>"       → event from stack top (current program)
"Program <pubkey> success"     → pop stack (optional, depth-based)
"Program <pubkey> consumed X"  → pop stack (same effect)
```

### Notable Programs Using emit_cpi!()

| Program ID | Name | Events/slot |
|------------|------|-------------|
| `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | Jupiter | ~60–80 |
| `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | PAMM | ~15–25 |
| `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | cPAMM | ~10–20 |
| `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Pump.fun | ~5–10 |
| `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` | Maverick | ~2–5 |

---

## API Design

### Final Design: `{txSignature}/{index}`

```
GET /witness/solana:{caip2}/{txSignature}/{index}
```

- `index`: zero-based position among emit_cpi!() events within that transaction
- Consumer already has the tx signature (from submission)
- Consumer knows their event order (they wrote the code)
- No discrminators, no slot numbers, no global indices needed

### CAIP-2 Format

Solana mainnet: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` (genesis hash)

Alternative: `solana:mainnet`, `solana:devnet`, `solana:testnet` for readability.

### Request Flow

1. Consumer calls `GET /witness/solana:{cluster}/{txSig}/{index}`
2. Service queries `indexed_events` for `(tx_signature, event_index_local)`
3. If found → load block events, rebuild Merkle tree, return `{ status: "ready", witness: {...} }`
4. If not found → fetch tx from RPC, extract slot, enqueue `index-slot` job, return `{ status: "pending" }`

### Response Shape

```json
{
  "status": "ready",
  "witness": {
    "signer": "base58pubkey...",
    "chainId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    "rootSlot": 291403883,
    "root": "0xabcd...",
    "proof": ["0x...", "0x..."],
    "signature": "base58...",
    "event": {
      "programId": "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      "discriminator": "0x982f4eebc0606e6a",
      "data": "0x..."
    }
  }
}
```

### Event Indexing (Worker Task `index-slot`)

Deterministic walk to assign event indices:

```
eventIndex = 0
for each tx in block.transactions (serialized order):
  resolve allAccts = staticAccounts + loadedWritable + loadedReadonly
  for each topIx in tx.message.instructions:
    parentProgram = allAccts[topIx.programIdIndex]
    if tx.meta.innerInstructions exists for this instruction index:
      for each innerIx in innerInstructions[instructionIndex]:
        if innerIx.programIdIndex resolves to parentProgram (self-CPI)
           AND innerIx.data starts with EVENT_IX_TAG:
          assign eventIndex++
          store: { slot, tx_signature, event_index_local: position within tx,
                   event_index: global, tree_index: position in sorted tree,
                   canonical_bytes, leaf_hash }
```

---

## Canonical Event Encoding

```
canonical = programId(32B) | event_discriminator(8B) | borsh_event_data(NB)
leaf_hash = keccak256(keccak256(canonical))
```

- `programId`: 32-byte Solana pubkey (base58-decoded)
- `event_discriminator`: 8 bytes from `ixData[8..16]` (skip EVENT_IX_TAG)
- `borsh_event_data`: remaining bytes from `ixData[16..]`
- Uses keccak256 (cross-chain protocol, not chain-native hashing)

For emit!() events, extract programId via CPI stack tracking and discriminator from first 8 bytes of decoded log data. Same canonical format.

---

## Proof & Merkle Tree Sizing

- ~141 events/slot → Merkle tree depth ≤ 8 levels
- Proof = 8 × 32 bytes = **256 bytes** (fixed, regardless of event data size)
- Leaf hash input: keccak256 over ~285 bytes avg (285 B × 141 events ≈ 40 KB/slot)
- Largest leaf: keccak256 over 1,280 bytes

This is trivial. The EVM witness service handles identical scales. Zero scaling concerns.

---

## Architecture Deviations from EVM

### What Changes

| Component | EVM | Solana |
|-----------|-----|--------|
| RPC library | viem | `@solana/kit` (`createSolanaRpc`) |
| Block fetch | `getBlock({ blockNumber })` | `getBlock(slot, { encoding: "json", maxSupportedTransactionVersion: 0 })` |
| Event source | `getLogs()` → flat log array | `innerInstructions` (emit_cpi!) or `logMessages` (emit!) |
| Event ID | `log.logIndex` (native) | txSignature + local index (assigned during indexing) |
| Canonical encoding | emitter(20B) + topicCount(1B) + topics[] + data | programId(32B) + discriminator(8B) + borshData |
| Data format | 0x hex in response | base58 (instruction data) / base64 (log data) |
| Block hash | 0x-prefixed hex (66 chars) | base58 (up to 44 chars) |
| Signing | EIP-712 + secp256k1 | Ed25519 (no recovery — include pubkey in response) |
| Signature recovery | `recoverAddress()` | Not applicable — return signer pubkey directly |
| Hash function | keccak256 | keccak256 (protocol choice, not chain-native) |
| Event ordering | `logIndex` (RPC-guaranteed) | Deterministic walk of txs → instructions → inner instructions |

### What Stays the Same

- Merkle tree (sorting, pairing, hashing)
- Graphile Worker job system (`index-slot` task, maxAttempts: 5)
- PostgreSQL with Drizzle ORM
- Multi-RPC consistency check pattern
- API flow (pending → indexing → ready/failed)
- Elysia HTTP server
- OpenTelemetry instrumentation
- Config/env loading

### What's Removed (Solana-only)

- `eth_getLogs` equivalent doesn't exist — must fetch full block
- No `recoverAddress` — Solana Ed25519 has no pubkey recovery

---

## DB Schema

Same structure as EVM, with field renaming and one new column.

```sql
-- chains (identical concept)
chains: chain_id, caip2, latest_slot, updated_at

-- rpcs (identical)
rpcs: id, chain_id, url

-- indexed_blocks → indexed_slots
indexed_slots: chain_id, slot, blockhash, merkle_root, latest_slot_at_index, signature, created_at

-- indexed_events
indexed_events: chain_id, slot, tx_signature,        -- NEW: tx_signature
                event_index_local,                    -- NEW: position within tx (0, 1, 2...)
                event_index,                          -- was log_index
                tree_index, leaf_hash, canonical_bytes
```

Key changes:
- `block_number` → `slot`
- `block_hash` → `blockhash` (base58 vs hex)
- `log_index` → `event_index` (still a flat ordinal within the slot)
- Added `tx_signature` for lookup
- Added `event_index_local` for per-tx ordering

---

## Multi-RPC Consistency

Same pattern as EVM, adapted for Solana data.

### Consistency Check (Worker Task)

1. Fetch block from ≥2 RPCs at slot S
2. Verify all RPCs return identical `blockhash`
3. For each RPC's block, extract emit_cpi!() events using self-CPI + EVENT_IX_TAG detection
4. Walk produces `[{programId, discriminator, canonicalBytes}, ...]` per RPC
5. Compare event arrays across RPCs — must be identical (count + content)
6. If any RPC disagrees → reject block
7. If consistent → build Merkle tree, sign, persist

### Why This Works

The walk order is deterministic because:
- `transactions[]` order is fixed by block leader
- `message.instructions[]` order is fixed by tx sender
- Inner instructions execute in CPI invocation order (deterministic by program logic)

If two RPCs disagree on event order/content (reorg, corrupted node, different skip-preflight settings), the mismatch is caught before we sign anything.

---

## Open Items

1. **Hash function for on-chain verification:** Using keccak256 for cross-chain protocol consistency. If Solana programs need on-chain verification, SHA-256 may be required (keccak256 is not a native Solana syscall).

2. **Signing key format:** EVM uses secp256k1 (64 hex chars). Solana uses Ed25519 (32 bytes, base58). The `Signer` interface is already abstracted — needs a `SolanaSigner` implementation.

3. **CAIP-2 naming standard:** `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` vs simpler `solana:mainnet`. Consumer-facing endpoints should accept both.

4. **Slot finality:** Witness service should use `finalized` commitment. Solana's optimistic confirmation (~400ms) has very rare but possible rollbacks.

5. **RPC provider recommendations for production:** Helius, Triton, QuickNode — all support the required `getBlock` with full transaction details. At least 2 independent providers required per chain.

6. **emit!() fallback:** ~47% of events still use log-based emit!(). CPI stack tracking must be implemented for full coverage. The canonical encoding is identical — just the extraction differs.

7. **Transaction lookup for lazy indexing:** When a consumer requests an unindexed `{txSig}/{index}`, the service needs `getTransaction(txSig)` to get the slot before indexing. This adds one extra RPC call compared to EVM's `{blockNumber}/{logIndex}` which already encodes the location.
