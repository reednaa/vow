
<h1 align="center">Vow</h1>

Vow is an event attestation framework for providing on-chain applications with an efficient multi-signed event inclusion statement. The framework is designed to be maximally flexible with minimal gas costs. A single event can be proved for as little as 33'000 gas (1 signer, 1'024-leaf tree). 

The project is split into three parts:

- [`/witness`](/witness): offchain witness service that indexes blocks, canonicalizes events, builds Merkle roots, signs roots, and serves proofs for individual events.
- [`/solidity`](/solidity): onchain verification library and witness directory contracts that validate witness signatures plus Merkle proofs and return raw canonical event bytes for consumer-selected decoding.
- [`/anchor`](/anchor): Solana/Anchor verification library and deployable mock program that preserve the Solidity `VowLib` payload, hashing, Merkle, signer ordering, and EVM signature semantics.

## Project Goal

Create the cheapest, most flexible, and most efficient cross-chain messaging-adjacent framework possible. Additionally, safety should be built in:

- Finality decisions is determined by witnesses off-chain.
- Multi-vendor solutions throughout the entire stack: Natively support multiple witness, multiple data sources. 
- Strong verification and truth policy: Each witness can independently attest to a block event root and each witness can use multiple truth sources.

## Strategy

1. Multiple witness operators independently derive the same canonical event set for a block.
2. They compute the same Merkle root and sign a typed message for that root.
3. A client packages one event, its Merkle proof, and witness signatures into a `vow` payload.
4. Consumer contracts call `VowLib.processVow(...)` to verify quorum signatures and proof membership, then decode the returned raw event bytes with the strategy they expect.

This gives applications a clear trust model: cryptographic proof of inclusion plus an explicit witness quorum policy.

## Anchor Workspace

The Anchor workspace mirrors the Solidity pattern:

- `anchor/crates/vow-lib` is the reusable Solana Vow library.
- `anchor/programs/mock-vow-lib` is a deployable mock program that stores a reference witness directory and calls the library.

Validate it with:

```bash
cargo fmt --manifest-path anchor/Cargo.toml --all -- --check
cargo test --manifest-path anchor/Cargo.toml --workspace
cargo build --manifest-path anchor/Cargo.toml --workspace
```

When the Solana CLI is installed, run `anchor build` from `anchor/` to build the deployable program.
