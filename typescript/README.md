# @vow/protocol

Stateless TypeScript SDK for Vow protocol consumers and witness operators.

The package owns the protocol byte layout and shared client flow:

- CAIP-2 normalization and numeric chain IDs
- EVM and Solana canonical event encoding
- double-keccak leaf hashes and sorted Merkle proofs
- Vow EIP-712 typed-data digest, compact signing, and signer recovery
- witness HTTP polling and multi-witness payload merging
- `VowLib.processVow`, `decodeEvent`, `decodeEmitCPI`, and `WitnessDirectory.getSigner` helpers through injected viem-compatible functions

## Install

```bash
bun add @vow/protocol
```

In this repository, `witness/` and `web/` consume it through `file:../typescript`.

## Encode A Vow

```ts
import { encodeVow, pollWitness, type SignedWitness } from "@vow/protocol";

const witness = await pollWitness("https://witness.example.com", {
  mode: "ethereum",
  chainId: "eip155:1",
  blockNumber: 25_061_118,
  logIndex: 2820,
});

const vow = encodeVow([
  { witness, signerIndex: 1 },
] satisfies SignedWitness[]);
```

## Verify With Viem

```ts
import { createPublicClient, http } from "viem";
import { processVow } from "@vow/protocol";

const client = createPublicClient({ transport: http("https://ethereum-rpc.publicnode.com") });

const { processVowResult } = await processVow({
  readContract: client.readContract,
  estimateContractGas: client.estimateContractGas,
  vowLibAddress: "0x...",
  directoryAddress: "0x...",
  vowBytes: vow,
});
```

The SDK does not create signers, submit transactions, or own private keys. Signing helpers accept caller-provided viem-compatible `signTypedData` functions.

## Development

```bash
bun install
bun run check
bun test
bun run build
```
