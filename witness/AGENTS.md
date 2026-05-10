# AGENTS.md

## Commands

```bash
bun run dev                 # API + worker in one process with hot reload

bun run db:generate         # Generate Drizzle migration artifacts from schema changes
bun run db:migrate          # Apply Drizzle migrations

bunx tsc --noEmit           # Type-check the service
bun test                    # Full test suite
bun test ./test/<file>      # Single test file
```

## Before Marking A Task Complete

- [ ] `bunx tsc --noEmit`
- [ ] `bun test`
- [ ] `bun run db:generate` if `src/db/schema.ts` changed

## Structure

- `src/api/` contains the HTTP API, health server, request handlers, and response models.
- `src/worker/` contains Graphile worker tasks and worker setup.
- `src/rpc/` contains EVM and Solana RPC clients plus consistency checks.
- `src/core/` contains canonical event encoding, Merkle logic, and signing utilities.
- `src/db/` contains the Drizzle schema and database client.
- `admin/` contains the small Svelte admin application.
- `drizzle/` contains checked-in SQL migrations and Drizzle snapshots.
- `test/` contains unit, integration, and E2E coverage.
- `scripts/` contains one-off diagnostics and investigation utilities.

## Rules

- Treat event encoding, Merkle tree construction, and witness signing as consensus-critical. Changes here usually require matching updates and tests in `../solidity/` and sometimes `../web/`.
- Keep API response shapes aligned with `src/api/model.ts`.
- Database changes require both schema updates and checked-in Drizzle migration artifacts. Do not generate migration files yourself.
- Prefer existing modules in `src/core/`, `src/rpc/`, and `src/db/` over parallel implementations.
- Keep worker behavior idempotent. Jobs may be retried.
- Do not weaken integration or E2E coverage to avoid real infrastructure dependencies.

## Documentation

- Update `witness/README.md` when commands, environment variables, operator workflow, or HTTP behavior change.
- Use `witness/reports/` for explorative discussions.
