# AGENTS.md

## Global Rules

- Never include cutover considerations.
- Unless explicitly asked, do not add compatibility layers, shims, fallbacks, or legacy handling.
- Never introduce helpers unless they materially reduce code.
- Rely on static types and existing invariants instead of validating the same value multiple times.

## Repository Map

- `witness/` contains the offchain witness service, DB schema, worker, telemetry, scripts, and admin UI.
- `solidity/` contains the Foundry contracts and tests for Vow verification.
- `web/` contains the Svelte demo for fetching witness payloads and calling `processVow`.

## Cross-Workspace Rules

- There is no single root build or test command. Run validation from every workspace you modify.
- Protocol changes are cross-cutting. Keep `witness/`, `solidity/`, and `web/` aligned on event encoding, Merkle rules, signer ordering, and Vow payload layout.
- Update the nearest `README.md` when commands, environment variables, or externally visible behavior change.
- There is no such thing as a pre-existing failure. Do not leave a touched workspace with failing checks.
