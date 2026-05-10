# Vow Anchor

`anchor/` mirrors the Solidity Vow workspace in Solana code.

It has two parts:

- `crates/vow-lib`: the reusable Rust verification library. This is the Solana equivalent of `solidity/src/VowLib.sol` plus the Borsh helpers in `solidity/src/BorshLib.sol`.
- `programs/mock-vow-lib`: a deployable Anchor reference program. This owns the directory PDAs and exposes thin wrapper instructions, similar to `solidity/src/mocks/MockVowLib.sol`.

## Mapping to Solidity

| Solidity | Anchor |
|---|---|
| `src/VowLib.sol` | `crates/vow-lib/src/vow.rs` + `crypto.rs` |
| `src/BorshLib.sol` | `crates/vow-lib/src/borsh.rs` |
| `src/WitnessDirectory.sol` | `programs/mock-vow-lib/src/lib.rs` PDA setup + `crates/vow-lib/src/directory.rs` layout helpers |
| `src/mocks/MockVowLib.sol` | `programs/mock-vow-lib` |

## Protocol Compatibility

- Vow payload bytes are intentionally identical across EVM and Solana.
- The Anchor port keeps the current EIP-712 `Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)` digest.
- Witness signer addresses remain 20-byte Ethereum addresses stored in signer-slot PDAs.
- Signature parsing accepts both the current 64-byte compact witness signatures and 65-byte `r || s || v` signatures.
- Solana canonical event bytes remain `programId(32) | discriminator(8) | borshData(N)`.

## Mock Program

`mock-vow-lib` is a reference wrapper, not the primary integration surface.

It exposes:

- `initialize_directory(quorum)`
- `set_signer(index, eth_address, quorum)`
- `process_vow(vow_data)`
- `decode_event(evt_bytes)`
- `decode_emit_cpi(evt_bytes)`

`process_vow`, `decode_event`, and `decode_emit_cpi` write Borsh-serialized results into Solana return data. That keeps the program stateless for local verification flows.

## Validation

Rust-only checks:

```bash
cargo test --manifest-path anchor/Cargo.toml
```

Anchor workspace checks:

```bash
anchor build
anchor test
```

Pure TypeScript vectors:

```bash
bun test tests/**/*.ts
```

## Toolchain

This workspace targets modern Anchor and Solana crates:

- `anchor-lang = 0.30.1`
- `solana-program = 2.2.1`

You need a matching `anchor` CLI and Solana toolchain installed locally to run `anchor build` or `anchor test`.
