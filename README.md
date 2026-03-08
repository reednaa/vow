# Vow

Vow is an event attestation system that lets onchain applications trust specific EVM logs without trusting a single RPC response.

The project is split into two parts:

- [`/witness`](/witness): offchain witness service that indexes blocks, canonicalizes events, builds Merkle roots, signs roots, and serves proofs for individual events.
- [`/solidity`](/solidity): onchain verification library and witness directory contracts that validate witness signatures plus Merkle proofs and return decoded event data.

## Project Goal

Make event consumption safer and more portable by separating:

- Event observation and attestation (offchain witness operators)
- Event verification and policy enforcement (onchain consumer contracts)

## Strategy

1. Multiple witness operators independently derive the same canonical event set for a block.
2. They compute the same Merkle root and sign a typed message for that root.
3. A client packages one event, its Merkle proof, and witness signatures into a `vow` payload.
4. Consumer contracts call `VowLib.processVow(...)` to verify quorum signatures and proof membership before accepting the event.

This gives applications a clear trust model: cryptographic proof of inclusion plus an explicit witness quorum policy.
