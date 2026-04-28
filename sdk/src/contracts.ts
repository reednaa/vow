/**
 * Contract ABIs and stateless read helpers for the Vow on-chain contracts.
 *
 * Design principle: no viem `PublicClient` is created here. Instead, all
 * functions that need to read from the chain accept a `ContractReadExecutor`
 * — a function with the same signature as `client.readContract` from viem.
 * This keeps the SDK transport-agnostic and avoids bundling an HTTP client.
 *
 * Usage with a viem `PublicClient`:
 * ```ts
 * import { createPublicClient, http } from "viem";
 * import { getDirectorySigner, processVow } from "vow-sdk/contracts";
 *
 * const client = createPublicClient({ transport: http(rpcUrl) });
 * const exec: ContractReadExecutor = (p) => client.readContract(p as any);
 *
 * const signer = await getDirectorySigner(exec, directoryAddress, 1);
 * const result = await simulateProcessVow(exec, mockVowLibAddress, directoryAddress, vowBytes);
 * ```
 */

import type { Address, Hex } from "viem";
import type { ContractReadExecutor, ProcessVowResult } from "./types.js";

// ── ABIs ──────────────────────────────────────────────────────────────────────

/**
 * ABI for the `WitnessDirectory` contract (view functions only).
 *
 * Full contract: `solidity/src/WitnessDirectory.sol`
 */
export const WITNESS_DIRECTORY_ABI = [
  {
    name: "getSigner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "signer", type: "address" }],
  },
  {
    name: "getQourumSet",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "indexMap", type: "uint256" }],
    outputs: [{ name: "signers", type: "address[]" }],
  },
] as const;

/**
 * ABI for the `IWitnessDirectory` errors.
 * Useful when decoding revert data from `processVow` failures.
 */
export const WITNESS_DIRECTORY_ERRORS_ABI = [
  {
    name: "NoQourum",
    type: "error",
    inputs: [
      { name: "requiredQourum", type: "uint256" },
      { name: "signers", type: "uint256" },
    ],
  },
  {
    name: "SignerIndexRepeat",
    type: "error",
    inputs: [],
  },
  {
    name: "ZeroSigner",
    type: "error",
    inputs: [],
  },
] as const;

/**
 * ABI for `MockVowLib` — an external view wrapper around `VowLib.processVow`.
 *
 * Used for simulation / gas estimation without executing a transaction.
 * Full contract: `solidity/src/mocks/MockVowLib.sol`
 */
export const MOCK_VOW_LIB_ABI = [
  {
    name: "InvalidlySignedRoot",
    type: "error",
    inputs: [],
  },
  {
    name: "TooManyTopics",
    type: "error",
    inputs: [],
  },
  {
    name: "NoQourum",
    type: "error",
    inputs: [
      { name: "requiredQourum", type: "uint256" },
      { name: "signers", type: "uint256" },
    ],
  },
  {
    name: "SignerIndexRepeat",
    type: "error",
    inputs: [],
  },
  {
    name: "ZeroSigner",
    type: "error",
    inputs: [],
  },
  {
    name: "processVow",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "directory", type: "address" },
      { name: "vow", type: "bytes" },
    ],
    outputs: [
      { name: "chainId", type: "uint256" },
      { name: "rootBlockNumber", type: "uint256" },
      { name: "emitter", type: "address" },
      { name: "topics", type: "bytes32[]" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

/**
 * Minimal ABI fragment for calling `processVow` on any contract that embeds
 * `VowLib` and exposes it as an external function. Consumers can compose this
 * with their own contract ABIs.
 */
export const PROCESS_VOW_FUNCTION_ABI = [
  {
    name: "processVow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "directory", type: "address" },
      { name: "vow", type: "bytes" },
    ],
    outputs: [
      { name: "chainId", type: "uint256" },
      { name: "rootBlockNumber", type: "uint256" },
      { name: "emitter", type: "address" },
      { name: "topics", type: "bytes32[]" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

// ── WitnessDirectory read helpers ─────────────────────────────────────────────

/**
 * Reads the signer address registered at a given index in a WitnessDirectory
 * contract.
 *
 * Returns `address(0)` if no signer is registered at that index.
 *
 * @param exec             - A viem-compatible `readContract` executor.
 * @param directoryAddress - Address of the deployed WitnessDirectory.
 * @param signerIndex      - The index to look up (1–255).
 * @returns The registered signer address.
 */
export async function getDirectorySigner(
  exec: ContractReadExecutor,
  directoryAddress: Address,
  signerIndex: number,
): Promise<Address> {
  const result = await exec({
    address: directoryAddress,
    abi: WITNESS_DIRECTORY_ABI,
    functionName: "getSigner",
    args: [BigInt(signerIndex)] as const,
  });
  return result as Address;
}

/**
 * Retrieves all signer addresses for a set of indices from a WitnessDirectory,
 * validating that they form a quorum set.
 *
 * The `indexMap` is a packed uint256 where indices are stored as 1-byte values
 * starting from the most significant byte, with a zero terminator. This is the
 * same format produced by {@link buildSignerIndexMap}.
 *
 * Reverts on-chain if:
 * - Indices are not strictly increasing (`SignerIndexRepeat`)
 * - Any index maps to `address(0)` (`ZeroSigner`)
 * - The count is less than the configured quorum (`NoQourum`)
 *
 * @param exec             - A viem-compatible `readContract` executor.
 * @param directoryAddress - Address of the deployed WitnessDirectory.
 * @param indexMap         - Packed index bitmap (use {@link buildSignerIndexMap}).
 * @returns Array of signer addresses in index order.
 */
export async function getQuorumSet(
  exec: ContractReadExecutor,
  directoryAddress: Address,
  indexMap: bigint,
): Promise<Address[]> {
  const result = await exec({
    address: directoryAddress,
    abi: WITNESS_DIRECTORY_ABI,
    functionName: "getQourumSet",
    args: [indexMap] as const,
  });
  return result as Address[];
}

/**
 * Builds the packed `uint256` index map accepted by
 * `WitnessDirectory.getQourumSet`.
 *
 * Indices are stored as 1-byte values in the most significant bytes of a
 * uint256, in strictly increasing order, terminated by a zero byte:
 *
 *   byte 0 = indices[0],  byte 1 = indices[1], ..., byte N = 0x00
 *
 * @param signerIndices - Signer indices (1–255), must be strictly increasing.
 * @returns The packed index map as a bigint.
 *
 * @throws If any index is 0, > 255, or the array is not strictly increasing.
 */
export function buildSignerIndexMap(signerIndices: number[]): bigint {
  if (signerIndices.length === 0) {
    return 0n;
  }
  if (signerIndices.length > 31) {
    throw new Error("Cannot fit more than 31 signer indices into a uint256 index map");
  }

  const sorted = [...signerIndices].sort((a, b) => a - b);

  for (let i = 0; i < sorted.length; i++) {
    const idx = sorted[i]!;
    if (idx === 0) throw new Error("Signer index 0 is reserved");
    if (idx > 255) throw new Error(`Signer index ${idx} exceeds 255`);
    if (i > 0 && idx <= sorted[i - 1]!) {
      throw new Error(`Duplicate signer index ${idx}; indices must be strictly increasing`);
    }
  }

  let map = 0n;
  for (let i = 0; i < sorted.length; i++) {
    // Shift index into position (31 - i) byte from the right, i.e. starting
    // from the most significant byte.
    map |= BigInt(sorted[i]!) << BigInt((31 - i) * 8);
  }

  return map;
}

// ── MockVowLib simulation ─────────────────────────────────────────────────────

/**
 * Simulates `VowLib.processVow` by calling `MockVowLib.processVow` as a view
 * function, returning the decoded event data without executing a transaction.
 *
 * This is useful for:
 * - Verifying a Vow payload is correctly formed before submitting it on-chain.
 * - Inspecting what event data a Vow attests to.
 * - Gas estimation.
 *
 * @param exec               - A viem-compatible `readContract` executor.
 * @param mockVowLibAddress  - Address of the deployed `MockVowLib` contract.
 * @param directoryAddress   - Address of the deployed `WitnessDirectory`.
 * @param vowBytes           - The encoded Vow payload (from {@link encodeVow}).
 * @returns The decoded event fields from the verified Vow.
 *
 * @throws If the Vow is invalid (invalid signatures, bad quorum, bad proof, etc.)
 *         — the revert is propagated as an error from the executor.
 */
export async function simulateProcessVow(
  exec: ContractReadExecutor,
  mockVowLibAddress: Address,
  directoryAddress: Address,
  vowBytes: Hex,
): Promise<ProcessVowResult> {
  const result = await exec({
    address: mockVowLibAddress,
    abi: MOCK_VOW_LIB_ABI,
    functionName: "processVow",
    args: [directoryAddress, vowBytes] as const,
  });

  const [chainId, rootBlockNumber, emitter, topics, data] = result as [
    bigint,
    bigint,
    Address,
    Hex[],
    Hex,
  ];

  return { chainId, rootBlockNumber, emitter, topics, data };
}

// ── Signer verification ───────────────────────────────────────────────────────

/**
 * Verifies that a witness's self-reported signer address matches what is
 * registered on-chain at the given index.
 *
 * Returns a result object rather than throwing, so callers can present the
 * discrepancy to users or handle it gracefully.
 *
 * @param exec              - A viem-compatible `readContract` executor.
 * @param directoryAddress  - Address of the deployed WitnessDirectory.
 * @param signerIndex       - The index to check.
 * @param reportedSigner    - The address the witness service claims to use.
 * @returns `{ onChainSigner, matches }` — the registered address and whether it matches.
 */
export async function verifyWitnessSigner(
  exec: ContractReadExecutor,
  directoryAddress: Address,
  signerIndex: number,
  reportedSigner: Address,
): Promise<{ onChainSigner: Address; matches: boolean }> {
  const onChainSigner = await getDirectorySigner(exec, directoryAddress, signerIndex);
  const matches =
    onChainSigner.toLowerCase() === reportedSigner.toLowerCase();
  return { onChainSigner, matches };
}
