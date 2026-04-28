/**
 * Core types for the Vow witness protocol SDK.
 *
 * These types model the full e2e flow:
 *   RPC event → witness service → proof → vow binary → on-chain processVow
 */

import type { Address, Hex } from "viem";

// ── Event types ───────────────────────────────────────────────────────────────

/**
 * A raw EVM log event, as returned by the RPC or the witness service.
 */
export interface RawEvent {
  /** Contract that emitted the event. */
  emitter: Address;
  /** Log topics (event signature + indexed params), each 32 bytes. */
  topics: Hex[];
  /** Non-indexed event data, arbitrary length. */
  data: Hex;
}

// ── Witness service response types ───────────────────────────────────────────

/**
 * The payload returned by a witness endpoint for a specific
 * (chainId, blockNumber, logIndex) when it has been indexed and signed.
 */
export interface WitnessPayload {
  /** Recovered address of the witness signer. */
  signer: Address;
  /** Chain ID the event was observed on. */
  chainId: number;
  /**
   * Block number at which the Merkle root was built.
   * This is the `rootBlockNumber` committed in the EIP-712 Vow struct.
   */
  rootBlockNumber: number;
  /**
   * The latest block number the witness had seen at indexing time.
   * A larger gap between rootBlockNumber and latestBlockNumber indicates
   * more confirmations.
   */
  latestBlockNumber: number;
  /** The Merkle root of all events in rootBlockNumber, signed by the witness. */
  root: Hex;
  /** The hash of the block at rootBlockNumber. */
  blockHash: Hex;
  /** Merkle proof path from this event's leaf to the root. */
  proof: Hex[];
  /**
   * EIP-2098 compact signature (64 bytes) over the EIP-712 Vow struct
   * {chainId, rootBlockNumber, root}.
   */
  signature: Hex;
  /** The event that was indexed. */
  event: RawEvent;
}

/** The witness endpoint returned `status: "ready"` — data is available. */
export interface WitnessResponseReady {
  status: "ready";
  witness: WitnessPayload;
}

/** The block has been queued but not yet indexed. */
export interface WitnessResponsePending {
  status: "pending";
}

/** The block is actively being indexed right now. */
export interface WitnessResponseIndexing {
  status: "indexing";
}

/** Indexing failed after exhausting retries. */
export interface WitnessResponseFailed {
  status: "failed";
  error: string;
}

/** An internal error occurred (e.g. signer recovery failure). */
export interface WitnessResponseError {
  status: "error";
  error: string;
}

/** Union of all possible witness HTTP responses. */
export type WitnessResponse =
  | WitnessResponseReady
  | WitnessResponsePending
  | WitnessResponseIndexing
  | WitnessResponseFailed
  | WitnessResponseError;

// ── Proof / signing types ─────────────────────────────────────────────────────

/**
 * Parameters for the EIP-712 Vow struct that the witness signs.
 *
 * Domain: empty (`EIP712Domain()` — no name, version, chainId, verifying
 * contract, or salt fields).
 *
 * Struct type string:
 *   `Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)`
 */
export interface VowSigningParams {
  chainId: bigint;
  rootBlockNumber: bigint;
  root: Hex;
}

/**
 * A Merkle tree represented as a 2D array where index 0 is the leaf layer
 * (sorted ascending) and the last entry is `[root]`.
 */
export type MerkleTree = Hex[][];

// ── Vow binary encoding types ─────────────────────────────────────────────────

/**
 * A witness proof paired with the signer's index in the on-chain
 * WitnessDirectory contract.
 *
 * `signerIndex` must be 1–255 (0 is a reserved sentinel).
 */
export interface SignedWitness {
  /** The complete witness payload from the witness endpoint. */
  witness: WitnessPayload;
  /**
   * The index of this signer in the WitnessDirectory contract (1–255).
   * Must match the on-chain entry, otherwise `processVow` will revert.
   */
  signerIndex: number;
}

/**
 * Decoded representation of the Vow binary format, sufficient to reconstruct
 * the binary or verify all fields manually.
 */
export interface DecodedVow {
  chainId: bigint;
  rootBlockNumber: bigint;
  /** Merkle proof path from the event leaf to the root. */
  proof: Hex[];
  /** Signer indices (1–255), strictly increasing. */
  signerIndices: number[];
  /** Raw signature bytes for each signer, in the same order as signerIndices. */
  signatures: Hex[];
  /** Canonical event bytes (the leaf pre-image). */
  eventBytes: Uint8Array;
}

// ── Contract / on-chain interaction types ─────────────────────────────────────

/**
 * The decoded result returned by `VowLib.processVow` (and MockVowLib).
 * All fields are taken directly from the verified event.
 */
export interface ProcessVowResult {
  chainId: bigint;
  rootBlockNumber: bigint;
  emitter: Address;
  topics: Hex[];
  data: Hex;
}

/**
 * Configuration for a WitnessDirectory deployment.
 */
export interface WitnessDirectoryConfig {
  /** Address of the deployed WitnessDirectory contract. */
  address: Address;
}

/**
 * Represents a configured witness endpoint, i.e. a running witness service
 * instance whose signer is registered at a known index in the directory.
 */
export interface WitnessEndpoint {
  /** Base URL of the witness HTTP service (no trailing slash). */
  url: string;
  /**
   * The signer index (1–255) this witness is registered at in the
   * WitnessDirectory contract.
   */
  signerIndex: number;
}

// ── Viem-compatible ABI executor pattern ─────────────────────────────────────

/**
 * A minimal representation of a viem `readContract` call, compatible with
 * `PublicClient.readContract`.
 *
 * Consumers pass a function matching this type so the SDK never creates its
 * own viem client or RPC transport.
 */
export interface ReadContractParams<
  TAbi extends readonly unknown[],
  TFunctionName extends string,
  TArgs extends readonly unknown[],
> {
  address: Address;
  abi: TAbi;
  functionName: TFunctionName;
  args: TArgs;
}

/**
 * External contract-read executor. Pass a bound `client.readContract` or any
 * compatible wrapper.
 *
 * @example
 * ```ts
 * import { createPublicClient, http } from "viem";
 * const client = createPublicClient({ transport: http(rpcUrl) });
 * const executor: ContractReadExecutor = (params) => client.readContract(params as any);
 * ```
 */
export type ContractReadExecutor = (
  params: ReadContractParams<readonly unknown[], string, readonly unknown[]>,
) => Promise<unknown>;

// ── Polling options ───────────────────────────────────────────────────────────

/** Options for polling a witness endpoint until it returns `ready`. */
export interface PollOptions {
  /** Milliseconds between poll attempts. Defaults to 1000. */
  pollIntervalMs?: number;
  /** Total polling budget in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
  /** AbortSignal to cancel polling early. */
  signal?: AbortSignal;
  /**
   * Called on each poll with the current status string so callers can show
   * progress to users.
   */
  onStatus?: (status: string) => void;
}
