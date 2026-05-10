# AGENTS.md

## Commands

```bash
cargo fmt --manifest-path anchor/Cargo.toml --all
cargo test --manifest-path anchor/Cargo.toml

bun test tests/**/*.ts

anchor build
anchor test
```

## Before Marking A Task Complete

- [ ] `cargo fmt --manifest-path anchor/Cargo.toml --all`
- [ ] `cargo test --manifest-path anchor/Cargo.toml`
- [ ] `bun test tests/**/*.ts`
- [ ] `anchor build` when the local Anchor/Solana toolchain is available
- [ ] `anchor test` when the local Anchor/Solana toolchain is available

## Structure

- `crates/vow-lib/` contains the reusable Solana verification library and should remain the primary integration surface.
- `crates/vow-lib/src/vow.rs` contains Vow parsing, Merkle reconstruction, signature normalization, and proof verification.
- `crates/vow-lib/src/borsh.rs` contains Borsh decoding helpers that mirror the Solidity `BorshLib`.
- `crates/vow-lib/src/directory.rs` contains signer-set and directory layout helpers used by programs.
- `programs/mock-vow-lib/` contains the deployable Anchor reference wrapper and PDA account definitions.
- `tests/` contains TypeScript protocol vectors and workspace-level behavior checks.

## Rules

- Keep the current library usage pattern in place. New protocol logic belongs in `crates/vow-lib`, not directly in `programs/mock-vow-lib`, unless the change is strictly program-owned.
- Preserve byte compatibility with `solidity/`, `witness/`, and any existing Vow payload producers:
  - same Vow header layout
  - same Merkle hashing and sorted-pair rules
  - same EIP-712 digest shape
  - same signer index ordering and quorum semantics
  - same Solana canonical event bytes: `programId(32) | discriminator(8) | borshData(N)`
- The mock program is a thin reference wrapper. Avoid duplicating library logic there unless required by Anchor account or return-data constraints.
- Do not introduce Solana-native protocol forks, alternate payload layouts, or fallback verification modes unless explicitly requested.
- Treat cross-workspace protocol behavior as consensus-critical. Changes here usually require matching updates and tests in `../solidity/`, `../witness/`, and sometimes `../web/`.
- Prefer direct, byte-oriented code over extra helper layers when the helper does not materially reduce duplication.

## Documentation

- Update `anchor/README.md` when commands, toolchain requirements, public instructions, account layouts, or externally visible mock-program behavior change.
