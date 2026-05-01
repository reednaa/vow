# Vow — Solana / Anchor

Anchor port of the [Vow EVM event attestation protocol](../solidity/README.md).

## Contracts

| Solidity source | Anchor module |
|---|---|
| `src/VowLib.sol` — event encode/decode, Merkle, signatures, `processVow` | `programs/vow/src/vow.rs` + `crypto.rs` |
| `src/WitnessDirectory.sol` — owner-managed signer directory | `programs/vow/src/directory.rs` |
| `src/IWitnessDirectory.sol` — directory interface | `lib.rs` `ProcessVow` account context |

## Instructions

| Instruction | Description |
|---|---|
| `initialize_directory(quorum)` | Creates the `WitnessDirectory` PDA. |
| `set_signer(index, eth_address, quorum)` | Stores a 20‑byte Ethereum signer address in `SignerSlot` PDA at `seeds = ["signer", index.to_le_bytes()]`. |
| `process_vow(vow_data)` | Decodes a vow, verifies Merkle proof, recovers secp256k1 signers from vow‑embedded signatures, and decodes the EVM event. |

## Byte‑identical vow payloads

A vow payload is **byte‑identical** on EVM and Solana. The same `vow_data` bytes
accepted by `VowLib.processVow` on Ethereum can be submitted to `process_vow` on
Solana — including the embedded 65‑byte ECDSA signatures.

Signatures are verified via the `secp256k1_recover` syscall:
- Recover the 64‑byte uncompressed public key from `(digest, r||s, v-27)`.
- Compute the Ethereum address as the last 20 bytes of `keccak256(pubkey)`.
- Compare against the stored ETH address in the signer slot PDA.

## Protocol differences (EVM → Solana)

| Aspect | EVM (Solidity) | Solana (Anchor) |
|---|---|---|
| Hashing | `keccak256` (EVM precompile) | `keccak256` (`tiny-keccak` crate) |
| Signatures | ECDSA `ecrecover` / `ERC-1271` | ECDSA `secp256k1_recover` syscall |
| Signer storage | EVM storage slots | PDA (`"signer"` + index) — stores `[u8; 20]` ETH address |
| Quorum check | `getQourumSet` reverts if < quorum | `process_vow` requires signer accounts ≥ quorum |
| Event format | `emitter(20B) \| N(1B) \| topics(N×32B) \| data` | Identical |

## Build & Test

```bash
anchor build
anchor test
```