/**
 * High-level orchestration helpers for the complete Vow e2e flow.
 *
 * These functions compose the lower-level modules (witness polling, encoding,
 * on-chain simulation) into common end-to-end workflows. They are stateless
 * and delegate I/O to the caller via injected executors.
 *
 * All transaction execution and signing are kept outside the SDK: consumers
 * provide a `ContractReadExecutor` for reads and their own signing/write logic
 * for transaction submission.
 */

import type { Address, Hex } from "viem";
import { pollAllWitnesses } from "./witness.js";
import { encodeVow } from "./vow.js";
import { verifyWitnessSigner, simulateProcessVow } from "./contracts.js";
import type {
  ContractReadExecutor,
  PollOptions,
  ProcessVowResult,
  WitnessEndpoint,
  WitnessPayload,
} from "./types.js";

// ── Proof collection result ───────────────────────────────────────────────────

/** Result of fetching and optionally verifying witnesses. */
export interface CollectedProof {
  /** The raw witness payload from this endpoint. */
  witness: WitnessPayload;
  /** The signer index this endpoint is registered at. */
  signerIndex: number;
  /**
   * On-chain signer verification result, populated only when `exec` and
   * `directoryAddress` are provided.
   */
  signerVerification?: {
    onChainSigner: Address;
    matches: boolean;
  };
}

// ── collectProofs ─────────────────────────────────────────────────────────────

/**
 * Fetches proofs from all configured witness endpoints and optionally
 * cross-checks each signer against the on-chain WitnessDirectory.
 *
 * This is the first step of the full e2e flow. The returned `CollectedProof[]`
 * can be passed directly to {@link buildVow} or to {@link encodeVow} after
 * extracting `{ witness, signerIndex }` pairs.
 *
 * @param endpoints         - Witness endpoints to query.
 * @param chainId           - Numeric EVM chain ID.
 * @param blockNumber       - Block number containing the event.
 * @param logIndex          - Log index within the block.
 * @param pollOptions       - Polling configuration.
 * @param fetchFn           - Optional fetch replacement for testing.
 * @param exec              - If provided, each signer is verified on-chain.
 * @param directoryAddress  - Required when `exec` is provided.
 * @returns Array of collected proofs, one per endpoint.
 */
export async function collectProofs(
  endpoints: WitnessEndpoint[],
  chainId: number,
  blockNumber: number,
  logIndex: number,
  pollOptions: PollOptions = {},
  fetchFn: typeof fetch = fetch,
  exec?: ContractReadExecutor,
  directoryAddress?: Address,
): Promise<CollectedProof[]> {
  const witnessed = await pollAllWitnesses(
    endpoints,
    chainId,
    blockNumber,
    logIndex,
    pollOptions,
    fetchFn,
  );

  if (!exec || !directoryAddress) {
    return witnessed.map((w) => ({
      witness: w.witness,
      signerIndex: w.signerIndex,
    }));
  }

  // Verify each signer on-chain in parallel.
  return Promise.all(
    witnessed.map(async (w) => {
      const signerVerification = await verifyWitnessSigner(
        exec,
        directoryAddress,
        w.signerIndex,
        w.witness.signer,
      );
      return {
        witness: w.witness,
        signerIndex: w.signerIndex,
        signerVerification,
      };
    }),
  );
}

// ── buildVow ──────────────────────────────────────────────────────────────────

/**
 * Encodes a set of collected proofs into the Vow binary payload.
 *
 * Optionally rejects encoding if any signer failed on-chain verification.
 *
 * @param proofs         - Output of {@link collectProofs}.
 * @param rejectUnverified - If `true`, throws when any signer failed
 *                           on-chain verification. Defaults to `true` when
 *                           `signerVerification` is present.
 * @returns The encoded Vow payload as a `0x`-prefixed hex string.
 *
 * @throws If any signer verification failed and `rejectUnverified` is `true`.
 */
export function buildVow(
  proofs: CollectedProof[],
  rejectUnverified = true,
): Hex {
  if (rejectUnverified) {
    for (const proof of proofs) {
      if (proof.signerVerification && !proof.signerVerification.matches) {
        throw new Error(
          `Signer at index ${proof.signerIndex} does not match on-chain address. ` +
            `Witness reported ${proof.witness.signer}, on-chain is ` +
            `${proof.signerVerification.onChainSigner}`,
        );
      }
    }
  }

  return encodeVow(proofs);
}

// ── Full e2e flow ─────────────────────────────────────────────────────────────

/**
 * Result of the full end-to-end Vow flow.
 */
export interface VowFlowResult {
  /** The encoded Vow payload, ready for `processVow(directory, vowBytes)`. */
  vowBytes: Hex;
  /** The proofs collected from each witness endpoint. */
  proofs: CollectedProof[];
  /**
   * The simulated on-chain result, populated only when `mockVowLibAddress` is
   * provided.
   */
  simulation?: ProcessVowResult;
}

/**
 * Options for the full end-to-end flow.
 */
export interface VowFlowOptions {
  /** Witness polling options. */
  pollOptions?: PollOptions;
  /**
   * A `readContract`-compatible executor for on-chain reads.
   * Required for signer verification and simulation.
   */
  exec?: ContractReadExecutor;
  /**
   * Address of the WitnessDirectory contract.
   * Required for signer verification and simulation.
   */
  directoryAddress?: Address;
  /**
   * Address of the MockVowLib contract.
   * Required for simulation (pass together with `exec` and `directoryAddress`).
   */
  mockVowLibAddress?: Address;
  /**
   * Whether to reject the Vow if a signer fails on-chain verification.
   * Defaults to `true`. Only relevant when `exec` and `directoryAddress` are set.
   */
  rejectUnverifiedSigners?: boolean;
  /** Optional fetch replacement. */
  fetchFn?: typeof fetch;
}

/**
 * Executes the full end-to-end Vow flow:
 *
 * 1. Poll all witness endpoints until ready.
 * 2. (Optional) Verify each signer against the on-chain WitnessDirectory.
 * 3. Encode the proofs into the Vow binary format.
 * 4. (Optional) Simulate `processVow` via MockVowLib.
 *
 * Transaction submission is intentionally outside this function — call the
 * appropriate write function with `vowFlowResult.vowBytes` after this returns.
 *
 * @param endpoints   - Witness endpoints to query.
 * @param chainId     - Numeric EVM chain ID.
 * @param blockNumber - Block number of the event.
 * @param logIndex    - Log index within the block.
 * @param options     - Configuration for verification, simulation, and polling.
 * @returns The Vow payload, proofs, and optional simulation result.
 */
export async function runVowFlow(
  endpoints: WitnessEndpoint[],
  chainId: number,
  blockNumber: number,
  logIndex: number,
  options: VowFlowOptions = {},
): Promise<VowFlowResult> {
  const {
    pollOptions = {},
    exec,
    directoryAddress,
    mockVowLibAddress,
    rejectUnverifiedSigners = true,
    fetchFn = fetch,
  } = options;

  // Step 1 (+ optional Step 2): collect and optionally verify proofs.
  const proofs = await collectProofs(
    endpoints,
    chainId,
    blockNumber,
    logIndex,
    pollOptions,
    fetchFn,
    exec,
    directoryAddress,
  );

  // Step 3: encode.
  const vowBytes = buildVow(proofs, rejectUnverifiedSigners);

  // Step 4 (optional): simulate on-chain.
  if (exec && directoryAddress && mockVowLibAddress) {
    const simulation = await simulateProcessVow(exec, mockVowLibAddress, directoryAddress, vowBytes);
    return { vowBytes, proofs, simulation };
  }

  return { vowBytes, proofs };
}
