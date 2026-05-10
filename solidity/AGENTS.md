# AGENTS.md

## Commands

```bash
forge build
forge test

forge fmt
forge fmt --check

forge snapshot
forge coverage --report lcov
```

## Before Marking A Task Complete

- [ ] `forge fmt`
- [ ] `forge build`
- [ ] `forge test`
- [ ] `forge coverage` do not use `--ir-minimum`
- [ ] `forge snapshot` if gas-sensitive paths changed

## Structure

- `src/VowLib.sol` contains event decoding, proof verification, and witness signature verification.
- `src/WitnessDirectory.sol` contains the reference signer directory implementation.
- `src/IWitnessDirectory.sol` contains the directory interface used by `VowLib`.
- `src/BorshLib.sol` contains Solana/Borsh decoding helpers used by the protocol.
- `src/mocks/` contains contracts used only by tests and local verification flows.
- `test/` contains Foundry tests and gas checks.

## Rules

- Keep event decoding, leaf hashing, Merkle proof reconstruction, typed-message hashing, signer index semantics, and compression behavior aligned with `../witness/` and `../web/`.
- Gas matters here. Prefer direct code over abstractions that add copies, branches, or indirection without a clear reduction in code size.
- Public interface or protocol changes require focused tests in `test/`, not only broad regression coverage.
- Do not change signer ordering, quorum semantics, or payload layout without updating the corresponding witness-side code and tests.

## Documentation

- Update `solidity/README.md` when integration flow, contract interfaces, or validation commands change.
