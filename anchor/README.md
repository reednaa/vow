# Vow Anchor

This workspace contains the Solana/Anchor implementation of the Vow verification pattern.

## Structure

- `crates/vow-lib`
  - Reusable Rust library for Vow payload parsing, Merkle reconstruction, EIP-712 hashing, EVM EOA signature recovery, and event decoding.
  - This crate is the Anchor analogue of `solidity/src/VowLib.sol`.
- `programs/mock-vow-lib`
  - Deployable Anchor mock program that stores a reference witness directory and calls `vow-lib`.
  - This program exists to exercise the library surface from a deployed Solana program, matching the Solidity `MockVowLib` pattern.

## Protocol Parity

`vow-lib` consumes the same Vow payload bytes as the Solidity implementation:

```text
chainId(32) | rootBlockNumber(32) | P(1) | S(1) | E(2be) | proof | signerIndices | signatures | event
```

The Solana library preserves:

- `Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)` typed-message hashing with the bare EIP-712 domain.
- Leaf hashing as `keccak256(keccak256(event_bytes))`.
- Sorted-pair Merkle reconstruction using the same `bytes32` ordering as Solidity.
- EVM event decoding as `emitter(20) | topic_count(1) | topics | data`.
- Solana `emit_cpi` event decoding as `programId(32) | discriminator(8) | data`.
- EVM EOA signatures over secp256k1, including both 64-byte EIP-2098 compact signatures and 65-byte `r || s || v` signatures with `v` as `27` or `28`.

ERC1271 contract signer verification is not implemented in the Solana library because Solana cannot natively evaluate EVM contract wallet code.

## Commands

Format:

```bash
cargo fmt --manifest-path anchor/Cargo.toml --all -- --check
```

Run tests:

```bash
cargo test --manifest-path anchor/Cargo.toml --workspace
```

Build Rust workspace:

```bash
cargo build --manifest-path anchor/Cargo.toml --workspace
```

Build deployable Anchor program:

```bash
anchor build
```

`anchor build` requires the Solana CLI toolchain to be available on `PATH`.
