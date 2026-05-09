# Solana Witness Exploration Scripts

Run with `bun run scripts/<name>.ts`.

Set `SOLANA_RPC_URL` env var to use a non-public RPC (recommended — public RPC rate-limits).

## Scripts

### `analyze-emit-cpi.ts` — Primary Analysis

Counts instructions, emit!() events, and emit_cpi!() events per slot. Detects emit_cpi! using both signals: self-CPI + `sha256("anchor:event")[0..8]` (`e445a52e51cb9a1d`).

```bash
SOLANA_RPC_URL="https://your-rpc" bun run scripts/analyze-emit-cpi.ts
```

### `event-sizes.ts` — Event Size Distribution

Samples emit_cpi!() decoded byte sizes across slots. Outputs percentiles and histogram.

```bash
SOLANA_RPC_URL="https://your-rpc" bun run scripts/event-sizes.ts
```

### `explore-solana-kit.ts` — @solana/kit Capabilities

Tests available RPC methods, counts emit!() events from logMessages, shows log structure.

```bash
SOLANA_RPC_URL="https://your-rpc" bun run scripts/explore-solana-kit.ts
```

### `inspect-emit-cpi.ts` — Early Detection Attempt

Initial self-CPI detection without EVENT_IX_TAG check. **Superseded by analyze-emit-cpi.ts.** Kept for inner instruction structure reference.

## Key Technical Details

- **Encoding must be `"json"`** — base64 doesn't expose parsed instructions
- **Inner instruction `data` is base58** — use `bs58.decode()`, not `Buffer.from(data, "base64")`
- **Log event `Program data:` is base64** — use `Buffer.from(data, "base64")`
- **public RPC rate-limits** — scripts use 2-3s delays between requests
- **`@solana/kit`** is the v2 Solana web3 SDK (`createSolanaRpc(url)`)
- **`bs58`** package needed for inner instruction data decoding

## Dependencies

```json
{
  "@solana/kit": "^6.9.0",
  "@solana/kit-client-rpc": "^0.11.0",
  "bs58": "^5.0.0"
}
```
