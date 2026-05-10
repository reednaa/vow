# vow-witness

`vow-witness` is an EVM and Solana event attestation service. It indexes EVM block logs and Solana `emit_cpi!()` events, builds a Merkle tree over canonical event encodings, signs the root, and serves event-level witness payloads over HTTP.

## What This Service Does

- Accepts EVM witness requests by chain/block/log index and Solana witness requests by chain/transaction/event index.
- Enqueues block indexing when data is not indexed yet.
- Fetches and cross-checks block/log data from multiple RPC providers.
- Canonicalizes configured chain IDs to CAIP-2 before storage and lookup.
- Persists indexed blocks/events in PostgreSQL.
- Returns a signed witness payload with Merkle proof when ready.

## System Design

Runtime architecture:

1. API server (`GET /witness/:caip2ChainId/:blockNumber/:logIndex` and `GET /witness/solana/:caip2ChainId/:txSignature/:index`)
2. Health server (`GET /health`)
3. Graphile Worker (processes `index-block` jobs, concurrency `1`)
4. PostgreSQL (stores witness data and worker jobs)

EVM request flow:

1. Client calls `GET /witness/eip155:{chainId}/{blockNumber}/{logIndex}`.
2. API validates chain config in `chains`.
3. If block is already indexed (`indexed_blocks`), API loads block events (`indexed_events`), rebuilds the Merkle tree, and returns `status: "ready"` with proof/signature.
4. If block is not indexed, API checks worker job state for `key = index:{chainId}:{blockNumber}`.
5. No job: enqueue `index-block`, return `status: "pending"`.
6. Locked job: return `status: "indexing"`.
7. Exhausted retries: return `status: "failed"`.
8. Worker task fetches block/logs from configured RPCs, verifies consistency, computes root/signature, writes indexed rows, and future requests return `ready`.

Solana request flow mirrors the same pattern with transaction-signature lookups, slot indexing (`index-solana-slot`), and canonical `emit_cpi!()` event bytes.

## Required Services

- Bun `1.3.5` or newer
- PostgreSQL `16`
- At least two RPC URLs per configured chain
- Solana chains require Solana JSON-RPC endpoints; EVM chains require Ethereum-compatible JSON-RPC endpoints
- Foundry (`anvil`) only if you run E2E tests

## Environment Variables

- `DATABASE_URL` (required): PostgreSQL connection string
- `WITNESS_PRIVATE_KEY` (required for `start` / `start:worker`): 32-byte hex private key (with or without `0x`)
- `WITNESS_SIGNER_ADDRESS` (required for `start:api`): 20-byte hex address for the configured signer
- `API_PORT` (optional): API server port, default `3000`
- `HEALTH_PORT` (optional): health server port, default `3001`
- `WORKER_HEALTH_PORT` (optional): worker health port for `start:worker`, default `3002`

## Run Locally

1. Install dependencies.

```bash
bun install
```

2. Start PostgreSQL.

```bash
docker compose up -d
```

3. Set environment variables.

```bash
export DATABASE_URL=postgresql://vow:vow@localhost:5433/vow_witness
export WITNESS_PRIVATE_KEY=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

4. Run DB migrations.

```bash
bun run db:migrate
```

5. Seed chain + RPC configuration (example: Ethereum mainnet).

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO chains (chain_id) VALUES ('eip155:1')
ON CONFLICT (chain_id) DO NOTHING;

DELETE FROM rpcs WHERE chain_id = 'eip155:1';
INSERT INTO rpcs (chain_id, url) VALUES
  ('eip155:1', 'https://eth.llamarpc.com'),
  ('eip155:1', 'https://rpc.ankr.com/eth');
SQL
```

Admin API and admin UI accept Solana aliases like `solana:mainnet`, `solana:devnet`, and `solana:testnet`, but store them canonically as genesis-hash CAIP-2 identifiers.

6. Start the witness service.

```bash
bun run start
```

Split-process local mode (matches production):

```bash
bun run start:migrate
# Use the address derived from WITNESS_PRIVATE_KEY
WITNESS_SIGNER_ADDRESS=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bun run start:api
bun run start:worker
```

## Verify Locally

Health endpoint:

```bash
curl http://localhost:3001/health
```

Worker health endpoint (split mode):

```bash
curl http://localhost:3002/health
```

Witness endpoint example:

```bash
curl http://localhost:3000/witness/eip155:1/19000000/0
```

Solana witness endpoint example:

```bash
curl http://localhost:3000/witness/solana/solana:mainnet/5N6gWm8YvM4wM8rA3JQn8Y3eGk9n7fN1nTn9gB9tQY8c/0
```

Expected response states:

- `{"status":"pending"}`: indexing job queued
- `{"status":"indexing"}`: worker currently processing
- `{"status":"ready","witness":{...}}`: witness proof/signature available
- `{"status":"failed","error":"..."}`: job exhausted retries
- `404 {"error":"Chain not configured"}`, `404 {"error":"Event not found at this logIndex"}`, or `404 {"error":"Event not found at this event index"}`

Polling helper:

```bash
while true; do
  curl -s http://localhost:3000/witness/eip155:1/19000000/0
  echo
  sleep 2
done
```

## Useful Checks

Recent indexed blocks:

```bash
psql "$DATABASE_URL" -c "SELECT chain_id, block_number, block_hash, merkle_root, latest_block_at_index, created_at FROM indexed_blocks ORDER BY created_at DESC LIMIT 10;"
```

Recent indexed events:

```bash
psql "$DATABASE_URL" -c "SELECT chain_id, block_number, log_index, tree_index, leaf_hash FROM indexed_events ORDER BY block_number DESC, log_index ASC LIMIT 20;"
```

## Troubleshooting

- `Missing required environment variable: ...`: set required role env vars (`DATABASE_URL`, and either `WITNESS_PRIVATE_KEY` or `WITNESS_SIGNER_ADDRESS`).
- `WITNESS_PRIVATE_KEY must be a 32-byte hex-encoded private key`: key must be exactly 64 hex chars (optional `0x` prefix).
- `Chain not configured`: add a matching row in `chains` for the requested CAIP-2 chain. Solana aliases are normalized to canonical genesis-hash CAIP-2 values before storage.
- `Chain X has only Y RPC(s). At least 2 required.`: add at least one more RPC URL for that chain in `rpcs`.
- Request stays `pending`/`indexing`: verify RPC URLs are reachable and return consistent block or slot data.
- `Event not found at this logIndex`: block indexed successfully but that log index does not exist in the block.
- `Event not found at this event index`: slot indexed successfully but that transaction-local Solana event index does not exist.

## Security Notes

- Treat `WITNESS_PRIVATE_KEY` as sensitive signing authority.
- In split mode, only the worker should receive `WITNESS_PRIVATE_KEY`; API should use `WITNESS_SIGNER_ADDRESS`.
- Use a dedicated non-production key for local development.
- Prefer RPC providers from independent operators to reduce correlated trust risk.

## Validation

```bash
bunx tsc --noEmit
bun test
```
