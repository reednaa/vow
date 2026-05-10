# Solana CPI Divergence Investigation

## Problem

Two Solana RPCs returned different `emit_cpi!()` event data for slot 418695462, event 2, causing the `fetchSolanaSlotConsistent` consistency check in `src/rpc/consistency.ts` to throw. The error indicated that the canonical bytes (and therefore leaf hashes) differed between RPC 0 and RPC 1 for event position 2.

## Investigation Approach

Created a diagnostic script at `scripts/diagnose-divergent-cpi.ts` that connects to the local PostgreSQL database (`chain_id=2`), fetches blocks and transactions from both RPCs, and compares at five levels:

1. **Block comparison** — hashes, transaction counts, signatures lists, ordering
2. **Transaction comparison** (via `getTransaction`) — account keys, instruction structure, inner instruction groups
3. **Event extraction comparison** (via `extractEmitCpiEvents`) — total event counts, per-event leaf hashes
4. **Raw inner instruction pinpointing** — walks both blocks manually to find the exact inner instruction producing the divergent event, decodes base58 data, shows EVENT_IX_TAG, discriminator, and borsh payload
5. **Account key comparison** — checks if `programIdIndex` resolution differs

Run with:
```bash
DATABASE_URL="postgresql://vow:vow@localhost:5433/vow_witness" bun run scripts/diagnose-divergent-cpi.ts
```

## Root Cause

**The two RPCs return different transaction orderings for the same slot.**

| Metric | RPC 0 (Alchemy) | RPC 1 (OrbitFlare) |
|--------|-----------------|---------------------|
| Block hash | `DTq66i7kRyc2a3BWtaijGAuVXmcuiUmn2g44mwzMi7ox` | `DTq66i7kRyc2a3BWtaijGAuVXmcuiUmn2g44mwzMi7ox` |
| Transaction count | 1156 | 1156 |
| Target tx index | 65 | 82 |
| Event 2 tx signature | `4Vxjs8QAGtQRUnt...` | `5JNCVmQQTPJMQ...` |
| Event 2 program | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` |
| Event 2 discriminator | `0xbd4233a826507599` | `0xbd4233a826507599` |

Despite sharing the same block hash and transaction count, the two RPCs have different transaction sets and ordering in the block. Event position 2 maps to a **different transaction** on each RPC, producing different event data — not because the same transaction is interpreted differently, but because the walk lands on a different transaction.

The first few transaction signatures in the block illustrate the ordering divergence:

```
RPC 0: 3EM1, 2i1S, 213B, HbCy, viED, ...
RPC 1: 3EM1, HbCy, sJNv, 213B, 4i1i, ...
```

However, when the target transaction is fetched individually via `getTransaction`, both RPCs return identical account keys, instruction structure, and inner instruction data — meaning the transaction content itself is consistent.

## Script Details

`scripts/diagnose-divergent-cpi.ts` is a standalone Bun script that:

- Connects to the DB using `createDb()` from `src/db/client.ts`
- Queries `rpcs` table for `chain_id = 2`
- Creates Solana RPC clients via `createSolanaRpcClient()`
- Fetches blocks and transactions from both RPCs
- Runs `extractEmitCpiEvents()` on both blocks and compares outputs
- Manually re-walks the blocks to find the exact divergent inner instruction
- Decodes and displays raw base58 instruction data, canonical bytes, programs, discriminators, and account keys from both RPCs side by side

Output includes checkbox-style markers:
- ✓ for matching values
- ✗ for divergent values

## Possible Next Steps

- **RPC quorum**: Move from strict pairwise comparison (2 RPCs must match) to a majority-vote system with 3+ RPCs
- **Retry logic**: Add delay-and-retry for transient RPC disagreements, since stale data may resolve on its own
- **RPC provider investigation**: Check with Alchemy and/or OrbitFlare why they disagree on block contents despite agreeing on the block hash
