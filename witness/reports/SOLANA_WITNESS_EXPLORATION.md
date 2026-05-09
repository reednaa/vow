# Solana Witness Service — Exploration Findings

## Key Metrics (Sampled from 8 Mainnet Slots)

| Metric | Value |
|--------|-------|
| Avg txs/slot | 1,177 |
| Avg top-level instructions/slot | 2,903 |
| Avg inner (CPI) instructions/slot | 1,611 |
| **Avg emit!() events/slot** | **125** (from logMessages) |
| **Avg emit_cpi!() events/slot** | **141** (from innerInstructions) |
| **Total events/slot** | **~266** |
| emit_cpi!() share | **53%** |
| % of inner-ix that are emit_cpi! | 8.7% |
| Slots with emit_cpi!() | 8/8 |

## emit_cpi!() IS the Dominant Event Mechanism

Previous assumption: emit_cpi!() wasn't widely adopted. **This is wrong.**

Major programs using emit_cpi!() on mainnet:
- `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` — **Jupiter** (aggregator)
- `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` — **Pump.fun** (token launchpad)
- `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` — PAMM
- `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` — cPAMM
- `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`
- `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e`

## Detection: Two Definitive Signals

### Signal 1: Self-CPI
Inner instruction's `programIdIndex` resolves to the same program as the parent instruction's `programIdIndex`.

### Signal 2: EVENT_IX_TAG (Magic Discriminator)
Anchor hardcodes `sha256("anchor:event")[0..8]` at the start of every emit_cpi! instruction data:
```
e4 45 a5 2e 51 cb 9a 1d
```
Verified on mainnet — all detected events have this tag.

### Full Instruction Data Layout
```
[EVENT_IX_TAG: 8 bytes] [event_discriminator: 8 bytes] [borsh event payload: N bytes]
```
- `EVENT_IX_TAG` = `sha256("anchor:event")[0..8]` — always the same
- `event_discriminator` = `sha256("event:EventName")[0..8]` — varies per event type
- Data is base58-encoded in the JSON RPC response (`ix.data`)

## Canonical Event Encoding for Witness

Extract from emit_cpi!() instruction:
```
canonical = programId(32B) | event_discriminator(8B) | borsh_event_data(NB)
leaf_hash = keccak256(keccak256(canonical))
```

This is cleaner than the emit!() log-based approach:
- **programId is explicit** — no CPI stack tracking needed
- **event_discriminator is explicit** — skip EVENT_IX_TAG, take bytes 8-15
- **No log truncation** — instruction data is always complete

## emit!() Events (Log-Based, Secondary Path)

For programs that haven't adopted emit_cpi!():
- Events in `tx.meta.logMessages` as `"Program data: <base64>"`
- Must track CPI stack to determine emitting program:
  ```
  Program <pubkey> invoke [N]  → push stack
  Program data: <base64>       → event from stack top
  Program <pubkey> success     → pop stack
  ```
- Canonical encoding is the same format as emit_cpi!()

## Architecture Decision

**Primary path:** Parse emit_cpi!() from `meta.innerInstructions` using self-CPI + EVENT_IX_TAG detection. This handles 53%+ of events with zero ambiguity.

**Secondary path:** Parse emit!() from `meta.logMessages` with CPI stack tracking for remaining ~47%.

**Canonical encoding is unified** — both paths produce identical `programId | event_discriminator | event_data` format.

## Key Deviations from EVM Witness Service

1. **Event extraction is dual-path** — innerInstructions + logMessages vs EVM's flat log array
2. **No eth_getLogs equivalent** — must fetch full block
3. **RPC encoding** — `json` encoding required (base64 doesn't expose parsed instructions)
4. **Data encoding** — inner instruction data is base58, log event data is base64
5. **blockhash** — base58 (44 chars) vs 0x hex (66 chars)
6. **Signing** — Ed25519 vs secp256k1, no signature recovery
7. **Event ordering** — composite key: (tx_index, inner_ix_index, instruction_index)

## Exploration Scripts

- `witness/scripts/explore-solana-kit.ts` — @solana/kit capabilities + emit!() counting
- `witness/scripts/inspect-emit-cpi.ts` — Self-CPI detection (initially broken, base64 encoding)
- `witness/scripts/analyze-emit-cpi.ts` — **Definitive analysis** with EVENT_IX_TAG + self-CPI detection
