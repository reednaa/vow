/**
 * vow-sdk — Stateless TypeScript library for the Vow witness protocol.
 *
 * ## Modules
 *
 * ### Types (`./types`)
 * All shared interfaces and type definitions used throughout the SDK.
 *
 * ### Encoding (`./encoding`)
 * Canonical event encoding (Vow binary ↔ emitter/topics/data), leaf hash
 * computation. Matches `VowLib.encodeEvent` / `_leafHash` on-chain.
 *
 * ### Merkle (`./merkle`)
 * Sorted binary Merkle tree: build, generate proof, verify proof.
 * Matches `VowLib.computeMerkleRootCalldata` (Solady MerkleProofLib) on-chain.
 *
 * ### Signing (`./signing`)
 * EIP-712 domain/types constants, Vow digest computation, signature helpers,
 * and the `SignVowFn` type for injecting external signers.
 *
 * ### Vow (`./vow`)
 * `encodeVow` / `decodeVow` for the full Vow binary payload,
 * `mergeWitnessProofs` for combining independently-fetched proofs.
 *
 * ### Witness (`./witness`)
 * HTTP client for the witness service: single fetch, polling, multi-endpoint
 * polling, combined fetch-and-encode.
 *
 * ### Contracts (`./contracts`)
 * ABI definitions for WitnessDirectory and MockVowLib, plus stateless read
 * helpers that accept an external `ContractReadExecutor` instead of creating
 * their own viem client.
 *
 * ### Orchestration (`./orchestration`)
 * High-level helpers that compose the above into the full e2e flow.
 *
 * ## Quick start
 *
 * ```ts
 * import { createPublicClient, http } from "viem";
 * import { runVowFlow } from "vow-sdk";
 *
 * const client = createPublicClient({ transport: http(rpcUrl) });
 *
 * const { vowBytes, simulation } = await runVowFlow(
 *   [{ url: "https://witness.example.com", signerIndex: 1 }],
 *   1,          // chainId: Ethereum mainnet
 *   21_000_000, // blockNumber
 *   0,          // logIndex
 *   {
 *     exec: (p) => client.readContract(p as any),
 *     directoryAddress: "0x5826BcAc448CA0951789f6EaC3056D07CBf88cF0",
 *     mockVowLibAddress: "0xb484F80cCb6Aa6e1e4c698e70B4ccF790b1cF9b9",
 *   },
 * );
 *
 * // vowBytes is ready to pass to your contract's processVow(directory, vowBytes)
 * ```
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type {
  RawEvent,
  WitnessPayload,
  WitnessResponse,
  WitnessResponseReady,
  WitnessResponsePending,
  WitnessResponseIndexing,
  WitnessResponseFailed,
  WitnessResponseError,
  VowSigningParams,
  MerkleTree,
  SignedWitness,
  DecodedVow,
  ProcessVowResult,
  WitnessDirectoryConfig,
  WitnessEndpoint,
  ReadContractParams,
  ContractReadExecutor,
  PollOptions,
} from "./types.js";

// ── Encoding ──────────────────────────────────────────────────────────────────

export {
  encodeEvent,
  encodeRawEvent,
  decodeEvent,
  computeLeafHash,
  computeEventLeafHash,
} from "./encoding.js";

// ── Merkle ────────────────────────────────────────────────────────────────────

export {
  ZERO_HASH,
  hashPair,
  buildMerkleTree,
  generateProof,
  verifyProof,
  findLeafIndex,
} from "./merkle.js";

// ── Signing ───────────────────────────────────────────────────────────────────

export {
  VOW_DOMAIN,
  VOW_TYPES,
  VOW_PRIMARY_TYPE,
  computeVowDigest,
  toCompactSignature,
  recoverVowSigner,
} from "./signing.js";

export type { SignVowFn } from "./signing.js";

// ── Vow binary ────────────────────────────────────────────────────────────────

export {
  encodeVow,
  decodeVow,
  extractEventFromVow,
  extractSignerIndexMap,
  mergeWitnessProofs,
  decodeProcessVowResult,
} from "./vow.js";

// ── Witness client ────────────────────────────────────────────────────────────

export {
  caip2ChainId,
  parseCaip2ChainId,
  buildWitnessUrl,
  fetchWitness,
  pollWitness,
  pollAllWitnesses,
  fetchAndEncodeVow,
} from "./witness.js";

// ── Contracts ─────────────────────────────────────────────────────────────────

export {
  WITNESS_DIRECTORY_ABI,
  WITNESS_DIRECTORY_ERRORS_ABI,
  MOCK_VOW_LIB_ABI,
  PROCESS_VOW_FUNCTION_ABI,
  getDirectorySigner,
  getQuorumSet,
  buildSignerIndexMap,
  simulateProcessVow,
  verifyWitnessSigner,
} from "./contracts.js";

// ── Orchestration ─────────────────────────────────────────────────────────────

export {
  collectProofs,
  buildVow,
  runVowFlow,
} from "./orchestration.js";

export type {
  CollectedProof,
  VowFlowResult,
  VowFlowOptions,
} from "./orchestration.js";
