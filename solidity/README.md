# Vow Solidity

This repository contains a Solidity implementation of the Vow event attestation protocol.

High level idea:
- For each source block, witnesses build a canonical list of events.
- Events are ordered by hash, merklized, and the root is signed by a quorum of witnesses.
- Applications submit a `vow` payload and call `VowLib.processVow(...)` to verify one proven event and recover its raw canonical bytes.

## Contracts

- `src/VowLib.sol`
  - Event encoding/decoding.
  - Event leaf hashing and Merkle root reconstruction from proofs.
  - Witness signature verification over a typed `Vow` message.
  - Main entrypoint for consumers: `processVow(address directory, bytes calldata vow)`.
  - Consumer-selected decoders: `decodeEvent(bytes calldata evt)` and `decodeEmitCPI(bytes calldata evt)`.
- `src/WitnessDirectory.sol`
  - Owner-managed signer directory.
  - Maps signer indexes to signer addresses.
  - Resolves and validates signer sets for a packed signer-index map.
- `src/IWitnessDirectory.sol`
  - Minimal interface expected by `VowLib.processVow`.

## Protocol Flow

1. Build canonical event bytes (`emitter || topic_count || topics || data`).
2. Compute leaf hash as `keccak256(keccak256(event_bytes))`.
3. Build a Merkle tree over block events (same algorithm for all witnesses and consumers).
4. Witnesses sign:
   - `chainId`
   - `latestBlockNumber`
   - `rootBlockNumber`
   - Merkle `root`
5. Submit a `vow` payload that includes:
   - Header fields
   - Proof nodes
   - Signer index map
   - Signatures
   - Encoded event
6. `processVow` verifies signer quorum and signatures, reconstructs root, and returns the raw canonical event bytes.
7. Consumer contracts choose the decoding strategy they expect and call either `decodeEvent(evt)` or `decodeEmitCPI(evt)`.

## Integrating `VowLib.processVow`

`processVow` is `internal`, so apps use it from their own contract and then explicitly decode the returned event bytes.

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { VowLib } from "./src/VowLib.sol";

contract Consumer {
  address public immutable directory;

  constructor(address _directory) {
    directory = _directory;
  }

  function consume(bytes calldata vow)
    external
    view
    returns (address emitter, bytes32[] calldata topics, bytes calldata data)
  {
    (uint256 chainId, uint256 rootBlockNumber, bytes calldata evt) = VowLib.processVow(
      directory,
      vow
    );

    require(chainId == block.chainid, "wrong chain");
    require(rootBlockNumber <= block.number, "bad block range");

    return VowLib.decodeEvent(evt);
  }
}
```

For Solana-style canonical events, the consumer makes the other explicit choice:

```solidity
(uint256 chainId, uint256 rootSlot, bytes calldata evt) = VowLib.processVow(directory, vow);
(bytes32 programId, bytes8 discriminator, bytes calldata data) = VowLib.decodeEmitCPI(evt);
```

### Integration checklist

- Validate protocol semantics in your app, not only cryptography:
  - `chainId == block.chainid` if cross-chain proofs are not intended.
  - Finality policy for `rootBlockNumber`.
  - Allowed emitters and expected topic schemas.
  - The expected event decoder for the canonical bytes you accept.
  - Optional idempotency guard (for example store processed `(rootBlockNumber, leafHash)`).
- Treat directory governance as trust-critical:
  - `processVow` fully trusts `directory.getQourumSet(...)`.
  - Rotating signers or quorum changes immediately affects acceptance.

This list is incomplete

## Choosing a Witness Directory

`VowLib` only requires `IWitnessDirectory.getQourumSet(uint256)` returning signer addresses in the expected verification order.

`WitnessDirectory` in this repo is a minimal owner-controlled reference implementation:
- Signer indices are one-byte domain (`1..255`), index `0` is sentinel.
- Index map must be strictly increasing and terminates at first zero byte.
- Quorum is global (`qourum`) and checked after resolving the signer list.
- Signers may be contracts or EOAs. Signers can change at any time effecting previously valid messages. Contract signers can revoke previously issued signatures.

### What applications should evaluate before choosing a directory

- Governance model:
  - Single owner vs multisig/timelock.
  - Change transparency and monitoring.
- Key lifecycle:
  - Rotation process and incident response for compromised signers.
- Policy flexibility:
  - Single global quorum vs per-domain/per-chain/per-block rules.
- Backward compatibility:
  - Whether historical roots should verify against historical signer sets.

If these constraints are too tight, implement a custom `IWitnessDirectory` with your policy rules.

## Witness (Signer) Operator Guidance

Witnesses should agree on one canonical offchain pipeline and treat it as consensus-critical.

### Before signing

- Use a deterministic event extraction pipeline for the target block.
- Encode each event exactly as expected by the consumer decoder:
  - EVM logs: `VowLib.decodeEvent`
  - Solana emit_cpi events: `VowLib.decodeEmitCPI`
- Compute leaf hashes exactly as `keccak256(keccak256(evt))`.
- Build Merkle levels with the same pair-hash convention used by consumers.
- Use deterministic ordering of leaves by hash for the block.
- Confirm `chainId` and `rootBlockNumber` policy.

### Signing details

Witnesses sign the typed `Vow` struct digest:
- `Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)`
- EIP-712 style digest with bare domain `keccak256("EIP712Domain()")`.

### Operational concerns

- Publish signatures with the exact signer index ordering expected by the directory.
- Ensure signer keys support your signature path:
  - EOAs (`ecrecover`) or contract wallets (`ERC1271`) via `SignatureCheckerLib`.
- Monitor directory updates and stop signing if policy diverges from expected governance.

## Development Commands

Build:

```bash
forge build
```

Run tests:

```bash
forge test
```

Run a specific suite or test:

```bash
forge test --match-contract WitnessDirectoryTest
forge test --match-test test_getQourumSet_returns_signers_in_index_order
```

Format:

```bash
forge fmt
forge fmt --check
```

Gas snapshot:

```bash
forge snapshot
```

Coverage report:

```bash
forge coverage --report lcov
```
