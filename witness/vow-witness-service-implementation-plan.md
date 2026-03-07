# Vow Witness Service — Implementation Plan

## Overview

This document specifies the design and implementation plan for an EVM event attestation (witness) service built on the Vow protocol. The service indexes EVM blocks, constructs Merkle trees over canonical event encodings, signs Merkle roots, and serves individual event proofs via a REST API.

The service is EVM-only. Chain identifiers use the CAIP-2 format (namespace `eip155`).

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Bun |
| HTTP API | Elysia |
| Worker health endpoint | Elysia (separate port) |
| Task queue | Graphile Worker |
| Database | PostgreSQL |
| ORM | Drizzle ORM (`drizzle-orm` + `drizzle-kit`) |
| Signing | In-process secp256k1 (key from ENV) |
| Testing | Bun test runner |

---

## API Design

### `GET /witness/{caip2ChainId}/{blockNumber}/{logIndex}`

Single idempotent endpoint. The CAIP-2 chain ID uses the `eip155` namespace (e.g., `eip155:1` for Ethereum mainnet). `blockNumber` and `logIndex` are decimal integers.

#### Response Shape

```
status: "pending" | "indexing" | "failed" | "ready"
```

When `status` is `"ready"`, the response includes the full Vow witness payload:

```
{
  status: "ready",
  witness: {
    chainId: number,
    latestBlockNumber: number,
    rootBlockNumber: number,
    root: string,            // bytes32 hex
    blockHash: string,       // bytes32 hex
    proof: string[],         // bytes32[] hex, Merkle proof siblings
    signature: string,       // packed signature hex
    signerIndex: number,
    event: {
      emitter: string,       // address hex
      topics: string[],      // bytes32[] hex
      data: string           // bytes hex
    }
  }
}
```

When `status` is `"failed"`:

```
{
  status: "failed",
  error: string              // human-readable reason
}
```

#### Endpoint Behavior

1. Parse and validate `caip2ChainId` (must be `eip155:*`), `blockNumber`, and `logIndex`.
2. Look up the block in the DB by `(chainId, blockNumber)`.
   - If the block is indexed and the `logIndex` exists: return `"ready"` with the proof.
   - If the block is indexed but `logIndex` does not exist: return `404`.
   - If a Graphile job exists and is pending/running: return `"pending"` or `"indexing"`.
   - If a Graphile job has permanently failed: return `"failed"`.
   - If no job exists: enqueue a new Graphile job for block indexing and return `"pending"`.
3. Job deduplication: use Graphile's `job_key` set to `index:{chainId}:{blockNumber}` so multiple requests for events in the same block share one indexing job.

---

## Database Schema

The schema is defined using Drizzle ORM's TypeScript schema definition. Drizzle handles migration generation via `drizzle-kit generate` and migration execution via `drizzle-kit migrate`. The schema is the single source of truth for both the database structure and TypeScript types.

### Drizzle Schema (`src/db/schema.ts`)

```typescript
import { pgTable, integer, bigint, text, customType, timestamp, serial, primaryKey, index } from "drizzle-orm/pg-core";

// Custom type for bytea columns (stored as Buffer in application code)
const bytea = customType<{ data: Buffer; dpiData: string }>({
  dataType() { return "bytea"; },
  toDriver(value: Buffer) { return value; },
  fromDriver(value: string) { return Buffer.from(value, "hex"); },
});

export const chains = pgTable("chains", {
  chainId: integer("chain_id").primaryKey(),           // Numeric chain ID (e.g., 1)
  caip2: text("caip2").notNull().unique(),             // CAIP-2 identifier (e.g., "eip155:1")
  latestBlock: bigint("latest_block", { mode: "bigint" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const rpcs = pgTable("rpcs", {
  id: serial("id").primaryKey(),
  chainId: integer("chain_id").notNull().references(() => chains.chainId),
  url: text("url").notNull(),
});

export const indexedBlocks = pgTable("indexed_blocks", {
  chainId: integer("chain_id").notNull().references(() => chains.chainId),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: bytea("block_hash").notNull(),            // Block hash all RPCs agreed on
  merkleRoot: bytea("merkle_root").notNull(),          // Computed Merkle root over all events
  latestBlockAtIndex: bigint("latest_block_at_index", { mode: "bigint" }).notNull(),
  signature: bytea("signature").notNull(),             // Witness signature over the Vow struct
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockNumber] }),
]);

export const indexedEvents = pgTable("indexed_events", {
  chainId: integer("chain_id").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  logIndex: integer("log_index").notNull(),            // Position in the block's log array
  leafHash: bytea("leaf_hash").notNull(),              // keccak256(keccak256(canonical_event_bytes))
  canonicalBytes: bytea("canonical_bytes").notNull(),  // Raw encoding: emitter || topic_count || topics || data
  treeIndex: integer("tree_index").notNull(),          // Position in sorted Merkle tree (by leaf_hash asc)
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockNumber, table.logIndex] }),
  index("idx_events_tree").on(table.chainId, table.blockNumber, table.treeIndex),
]);
```

At least 2 RPCs per chain are required for consistency checks. All RPCs must agree (unanimous, not majority).

### Drizzle Configuration (`drizzle.config.ts`)

Drizzle Kit is used for migration generation and execution. The config points at the schema file and reads the database URL from the environment.

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Migration Workflow

Agents should use the following commands for schema changes:

- `bunx drizzle-kit generate` — generates SQL migration files from schema changes into the `./drizzle` directory.
- `bunx drizzle-kit migrate` — applies pending migrations to the database.
- `bunx drizzle-kit push` — for development only: pushes schema directly without generating migration files.

### Query Patterns

Database queries use Drizzle's query builder. The Drizzle client is instantiated once at startup and passed through to handlers and job functions. Use `drizzle-orm/pg-core` with the `postgres` driver (`drizzle-orm/postgres-js`).

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
```

For the transactional block indexing write (inserting into `indexed_blocks` and `indexed_events` atomically), use Drizzle's `db.transaction()`. For the `latest_block` update, use Drizzle's `sql` template for the `greatest()` expression to avoid overwriting a higher value from a concurrent job.

---

## Graphile Worker: Block Indexing Job

### Job Name

`index-block`

### Job Key

`index:{chainId}:{blockNumber}` — ensures deduplication.

### Job Payload

```
{
  chainId: number,
  blockNumber: number
}
```

### Execution Flow

1. **Fetch RPCs** from the `rpcs` table for the given `chainId`.
2. **Fetch block headers** from all RPCs (`eth_getBlockByNumber`). Extract `block_hash` from each.
   - If any RPC does not have the block, or block hashes disagree: **throw** (triggers Graphile retry with backoff).
3. **Fetch logs** from all RPCs (`eth_getLogs` with the block number range `[blockNumber, blockNumber]`).
4. **Consistency check**: for each RPC response, compute the set of `(logIndex, leafHash)` tuples using canonical encoding + double-keccak hashing. All RPC responses must produce identical sets. If not, **throw**.
5. **Build Merkle tree**:
   - Sort leaves ascending by `leaf_hash`.
   - Construct a binary Merkle tree using sorted-pair hashing at each level (see Merkle Tree Construction below).
   - Record each leaf's `tree_index` (its position in the sorted order).
6. **Update `latest_block`**: set `chains.latest_block = max(chains.latest_block, current_head)` where `current_head` is fetched from RPCs during step 2. This piggybacks on the indexing job to keep the latest block value fresh.
7. **Sign the Vow struct**: compute the EIP-712 typed struct hash for `Vow(uint256 chainId, uint256 latestBlockNumber, uint256 rootBlockNumber, bytes32 root)` using the bare domain separator `keccak256("EIP712Domain()")`. Sign with the service's private key.
8. **Store everything** in a single transaction:
   - Insert into `indexed_blocks`.
   - Insert all events into `indexed_events`.

### Retry Policy

Exponential backoff: 5s, 15s, 45s, 135s, 405s. Max 5 attempts. After exhaustion, the job is marked permanently failed and the GET endpoint returns `"failed"`.

### Concurrency

Serialized execution: Graphile Worker concurrency set to 1. This prevents overwhelming RPCs and avoids race conditions on `latest_block` updates.

---

## Canonical Event Encoding

Each EVM log is encoded as:

```
emitter (20 bytes) || topic_count (32 bytes, uint256) || topic_0 (32 bytes) || ... || topic_n (32 bytes) || data (variable)
```

This must match the encoding expected by `VowLib.decodeEvent` exactly. The emitter is the 20-byte address (no left-padding). Topic count is ABI-encoded as a `uint256`. Topics are raw `bytes32`. Data is raw bytes.

### Leaf Hashing

```
leaf_hash = keccak256(keccak256(canonical_event_bytes))
```

Double hashing prevents second preimage attacks on the Merkle tree.

---

## Merkle Tree Construction

This must be implemented to match the on-chain verification in `VowLib.computeMerkleRootCalldata` exactly.

### Algorithm

1. **Sort** all leaf hashes ascending (lexicographic byte order, which equals numeric order for `bytes32`).
2. **Build levels bottom-up**. At each level, pair adjacent nodes. For each pair, place the smaller hash on the left and the larger on the right, then hash them together: `keccak256(min(a, b) || max(a, b))`.
3. **Odd node count at any level**: the unpaired node promotes to the next level without hashing. It does **not** get duplicated.
4. Continue until one root remains.

### Proof Generation

For a given leaf at `tree_index`, the proof is the list of sibling hashes encountered when walking from the leaf to the root. The on-chain verifier uses the same sorted-pair convention to determine ordering, so the proof does not need to encode left/right direction — the verifier infers it by comparing hash values.

---

## Signing

### Key Management

The private key is loaded from an environment variable (`WITNESS_PRIVATE_KEY`) at service startup. It is parsed once and held in memory for the lifetime of the process.

The signing logic should be behind a clean interface:

```
interface Signer {
  sign(digest: Uint8Array): Promise<{ v: number, r: Uint8Array, s: Uint8Array }>
  address(): string
}
```

This allows future migration to KMS, Vault, or HSM without changing business logic.

### EIP-712 Signing

The Vow struct digest is computed as:

```
domainSeparator = keccak256("EIP712Domain()")
structHash = keccak256(abi.encode(
  keccak256("Vow(uint256 chainId,uint256 latestBlockNumber,uint256 rootBlockNumber,bytes32 root)"),
  chainId,
  latestBlockNumber,
  rootBlockNumber,
  root
))
digest = keccak256("\x19\x01" || domainSeparator || structHash)
```

The service signs `digest` with its private key using secp256k1 (`ecrecover`-compatible).

### Environment Variable

`WITNESS_PRIVATE_KEY` — hex-encoded 32-byte private key (with or without `0x` prefix). The corresponding address must be registered as a signer in the on-chain `WitnessDirectory`.

---

## Proof Serving (GET Response Assembly)

When the GET endpoint resolves to `"ready"`:

1. Load the `indexed_blocks` row for `(chainId, blockNumber)`.
2. Load the `indexed_events` row for `(chainId, blockNumber, logIndex)`.
3. Load all sibling leaves/nodes needed to reconstruct the Merkle proof for the event's `tree_index`. This can be done by loading all events for the block (since we need the full tree to compute proof paths) or by storing precomputed proof paths. For simplicity, reconstruct the tree in memory from all stored events for the block and extract the proof.
4. Assemble the response with the block's `signature`, `merkle_root`, the event's `canonical_bytes` (decoded into `emitter`, `topics`, `data`), and the proof path.

---

## Service Architecture

### Processes

Two Elysia servers and one Graphile Worker, all running in the same Bun process (or split across processes if needed):

1. **API server** (external-facing): serves `GET /witness/{caip2ChainId}/{blockNumber}/{logIndex}`. This is the only externally exposed endpoint.
2. **Health server** (internal): serves `GET /health` for worker health checks, liveness, and readiness probes. Runs on a separate port.
3. **Graphile Worker**: processes `index-block` jobs. Concurrency: 1.

### Startup Sequence

1. Parse and validate `WITNESS_PRIVATE_KEY`. Derive signer address. Log the address (not the key).
2. Connect to PostgreSQL via `postgres` driver. Instantiate Drizzle client. Run migrations via `drizzle-orm/migrator` (reads from `./drizzle` folder).
3. Start Graphile Worker.
4. Start health server.
5. Start API server.

### Graceful Shutdown

On `SIGTERM` / `SIGINT`: stop accepting new HTTP requests, let in-flight requests complete, let the current Graphile job finish (with a timeout), then close DB connections and exit.

---

## Project Structure

```
vow-witness/
├── src/
│   ├── index.ts                 # Entrypoint: startup sequence
│   ├── api/
│   │   ├── server.ts            # Elysia API server setup
│   │   ├── witness.handler.ts   # GET /witness handler
│   │   └── health.server.ts     # Elysia health server
│   ├── worker/
│   │   ├── setup.ts             # Graphile Worker setup
│   │   └── index-block.task.ts  # Block indexing job logic
│   ├── core/
│   │   ├── encoding.ts          # Canonical event encoding
│   │   ├── merkle.ts            # Merkle tree construction + proof generation
│   │   ├── signing.ts           # EIP-712 digest computation + signing
│   │   └── signer.interface.ts  # Signer abstraction
│   ├── rpc/
│   │   ├── client.ts            # EVM JSON-RPC client
│   │   └── consistency.ts       # Multi-RPC fetch + consistency validation
│   ├── db/
│   │   ├── client.ts            # Drizzle client instantiation (postgres-js driver)
│   │   └── schema.ts            # Drizzle table definitions (single source of truth)
│   └── config/
│       └── env.ts               # Environment variable parsing + validation
├── drizzle/                     # Auto-generated SQL migrations (via drizzle-kit generate)
├── drizzle.config.ts            # Drizzle Kit configuration
├── test/
│   ├── encoding.test.ts
│   ├── merkle.test.ts
│   ├── signing.test.ts
│   ├── consistency.test.ts
│   ├── index-block.test.ts
│   └── witness.handler.test.ts
├── package.json
├── tsconfig.json
└── docker-compose.yml           # PostgreSQL for local dev
```

---

## Testing Strategy

All tests run via `bun test`.

### Unit Tests

- **encoding.ts**: verify canonical encoding matches reference vectors derived from Solidity's `VowLib.decodeEvent`. Test with varying topic counts (0–4), empty data, large data.
- **merkle.ts**: verify tree construction and proof generation against known roots. Test edge cases: single leaf, two leaves, odd leaf counts, large trees. Cross-validate proofs against the Solidity `computeMerkleRootCalldata` by running Forge tests with the same inputs.
- **signing.ts**: verify EIP-712 digest computation produces the same digest as Solidity. Verify signatures recover to the expected address.

### Integration Tests

- **index-block task**: mock RPC responses, run the full job, verify DB state (block row, event rows, correct leaf hashes, correct Merkle root, valid signature).
- **consistency checks**: test with agreeing RPCs, disagreeing block hashes, disagreeing event sets, missing blocks.
- **GET /witness handler**: test all response states (`pending`, `indexing`, `ready`, `failed`, `404`). Verify proof correctness end-to-end.

### Cross-Validation with Solidity

Critical: the canonical encoding, leaf hashing, Merkle tree, and EIP-712 signing must produce byte-identical outputs to the Solidity implementation. The recommended approach is to generate test vectors in Forge (using `VowLib` directly) and consume them in the Bun test suite. Store these vectors as JSON fixtures.

---

## Dependencies

| Package | Purpose |
|---|---|
| `elysia` | HTTP framework |
| `graphile-worker` | Job queue |
| `drizzle-orm` | TypeScript ORM — schema definition, query builder, migrations |
| `drizzle-kit` | Dev dependency — migration generation and CLI tooling |
| `postgres` | Underlying PostgreSQL driver (used by `drizzle-orm/postgres-js`) |
| `viem` | EVM utilities: ABI encoding, keccak256, secp256k1 signing, RPC client |

`viem` is the preferred EVM library. It provides keccak256, ABI encoding, EIP-712 typed data hashing, secp256k1 signing, and JSON-RPC transport — covering most of the cryptographic and RPC needs without additional dependencies.

`drizzle-orm` is the ORM layer. It uses `postgres` (porsager/postgres) as the underlying driver via the `drizzle-orm/postgres-js` adapter. The schema file (`src/db/schema.ts`) is the single source of truth for both database structure and TypeScript types — no separate type definitions or raw SQL migration authoring needed. Drizzle Kit generates SQL migrations automatically from schema diffs.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WITNESS_PRIVATE_KEY` | Yes | Hex-encoded secp256k1 private key. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `API_PORT` | No | API server port. Default: `3000`. |
| `HEALTH_PORT` | No | Health server port. Default: `3001`. |

---

## Considerations and Open Items

### Future Improvements

- **Key management upgrade**: migrate from ENV-based key to cloud KMS or Vault. The `Signer` interface is designed to support this without business logic changes.
- **Rate limiting**: the endpoint triggers RPC calls and DB writes on unknown blocks. Rate limiting or authentication should be added before exposing publicly.
- **Proof caching**: currently, proofs are reconstructed from stored events on every request. If a block's events are requested frequently, precomputed proofs could be stored or cached in memory.
- **Multi-witness coordination**: this service is a single witness. Running multiple witnesses requires separate key management and a coordination layer for aggregating signatures into a quorum.
- **Block cache eviction**: over time, `indexed_blocks` and `indexed_events` will grow. Consider a retention policy (e.g., keep last N blocks per chain, or evict blocks older than T).
- **Monitoring and alerting**: track job failure rates, RPC error rates, indexing latency, and signing operations. Alert on repeated job failures or RPC disagreements (which may indicate chain-level issues).

### Trust Assumptions

- The service trusts that if all configured RPCs agree on a block hash and event set, the data is canonical. An attacker controlling all RPCs for a chain could feed false data. Operators should use RPCs from diverse, independent providers.
- The signing key is as sensitive as the witness's on-chain authority. Compromise of the key allows forging attestations. The ENV-based approach is acceptable for development but should be upgraded for production.
- The service does not enforce finality policy. It attests blocks at any depth (head indexing). Consumers are responsible for evaluating `latestBlockNumber` and `rootBlockNumber` against their own finality requirements.
