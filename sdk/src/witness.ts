/**
 * Witness service HTTP client.
 *
 * The witness service exposes one public endpoint per indexed event:
 *
 *   GET {baseUrl}/witness/{caip2ChainId}/{blockNumber}/{logIndex}
 *
 * where `caip2ChainId` is in the form `eip155:{decimal chainId}`.
 *
 * Response statuses:
 *   "ready"    — event is indexed and signed; `witness` field is populated.
 *   "pending"  — block is queued but not yet indexed.
 *   "indexing" — block is actively being indexed.
 *   "failed"   — indexing exhausted retries; `error` field is populated.
 *   "error"    — internal error (e.g. signer recovery failed).
 *
 * All functions here are stateless and take explicit parameters instead of
 * closing over configuration.
 */

import type { WitnessEndpoint, WitnessPayload, WitnessResponse, PollOptions } from "./types.js";
import { encodeVow } from "./vow.js";
import type { Hex } from "viem";

// ── CAIP-2 helpers ────────────────────────────────────────────────────────────

/**
 * Formats a numeric EVM chain ID as a CAIP-2 chain identifier string.
 *
 * @example
 * ```ts
 * caip2ChainId(1)     // "eip155:1"
 * caip2ChainId(137)   // "eip155:137"
 * ```
 */
export function caip2ChainId(chainId: number): string {
  return `eip155:${chainId}`;
}

/**
 * Parses a CAIP-2 chain ID string into a numeric chain ID.
 *
 * @throws If the string is not in the `eip155:{decimal}` format.
 */
export function parseCaip2ChainId(caip2: string): number {
  const match = /^eip155:(\d+)$/.exec(caip2);
  if (!match || !match[1]) {
    throw new Error(
      `Invalid CAIP-2 chain ID: "${caip2}". Expected format: eip155:{decimal}`,
    );
  }
  return parseInt(match[1], 10);
}

// ── Single fetch ──────────────────────────────────────────────────────────────

/**
 * Builds the URL for a witness endpoint request.
 *
 * @param baseUrl     - Base URL of the witness service (no trailing slash).
 * @param caip2       - CAIP-2 chain ID string, e.g. `"eip155:1"`.
 * @param blockNumber - The block number containing the event.
 * @param logIndex    - The log index of the event within the block.
 */
export function buildWitnessUrl(
  baseUrl: string,
  caip2: string,
  blockNumber: number,
  logIndex: number,
): string {
  return `${baseUrl}/witness/${caip2}/${blockNumber}/${logIndex}`;
}

/**
 * Performs a single HTTP fetch against a witness endpoint.
 *
 * Does not retry or poll — returns whatever the endpoint returns. Use
 * {@link pollWitness} for automatic polling until ready.
 *
 * @param baseUrl     - Base URL of the witness service.
 * @param chainId     - Numeric EVM chain ID.
 * @param blockNumber - Block number of the event.
 * @param logIndex    - Log index of the event within the block.
 * @param fetchFn     - Optional fetch replacement (defaults to global `fetch`).
 * @returns The parsed JSON response from the witness endpoint.
 *
 * @throws On non-2xx HTTP status or network error.
 */
export async function fetchWitness(
  baseUrl: string,
  chainId: number,
  blockNumber: number,
  logIndex: number,
  fetchFn: typeof fetch = fetch,
): Promise<WitnessResponse> {
  const url = buildWitnessUrl(baseUrl, caip2ChainId(chainId), blockNumber, logIndex);
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Witness service returned HTTP ${res.status} for ${url}`);
  }
  return res.json() as Promise<WitnessResponse>;
}

// ── Polling ───────────────────────────────────────────────────────────────────

/**
 * Polls a single witness endpoint until it returns `status: "ready"` or an
 * unrecoverable terminal state (`"failed"`, `"error"`).
 *
 * Intermediate statuses (`"pending"`, `"indexing"`) trigger a wait of
 * `pollIntervalMs` before the next attempt.
 *
 * @param baseUrl     - Base URL of the witness service.
 * @param chainId     - Numeric EVM chain ID.
 * @param blockNumber - Block number of the event.
 * @param logIndex    - Log index within the block.
 * @param options     - Poll interval, timeout, abort signal, status callback.
 * @param fetchFn     - Optional fetch replacement (e.g. for testing).
 * @returns The witness payload once `status === "ready"`.
 *
 * @throws On terminal failures, timeout, or abort signal.
 */
export async function pollWitness(
  baseUrl: string,
  chainId: number,
  blockNumber: number,
  logIndex: number,
  options: PollOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<WitnessPayload> {
  const { pollIntervalMs = 1000, timeoutMs = 60_000, signal, onStatus } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("Polling aborted");
    }

    const body = await fetchWitness(baseUrl, chainId, blockNumber, logIndex, fetchFn);
    onStatus?.(body.status);

    if (body.status === "failed" || body.status === "error") {
      throw new Error(
        `Witness at ${baseUrl} reported terminal status "${body.status}": ${body.error}`,
      );
    }

    if (body.status === "ready") {
      return body.witness;
    }

    // status === "pending" or "indexing" — wait and retry.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, pollIntervalMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("Polling aborted"));
      });
    });
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for witness at ${baseUrl} ` +
      `(block ${blockNumber}, logIndex ${logIndex})`,
  );
}

// ── Multi-endpoint polling ────────────────────────────────────────────────────

/**
 * Polls multiple witness endpoints concurrently until all return `status:
 * "ready"`, then returns the results paired with their signer indices.
 *
 * Each endpoint is polled independently. The function resolves once the last
 * endpoint becomes ready, subject to the shared timeout.
 *
 * @param endpoints - Array of `{ url, signerIndex }` configurations.
 * @param chainId     - Numeric EVM chain ID.
 * @param blockNumber - Block number of the event.
 * @param logIndex    - Log index within the block.
 * @param options     - Shared poll interval / timeout / signal / callback.
 * @param fetchFn     - Optional fetch replacement.
 * @returns Array of `{ witness, signerIndex }` in the same order as `endpoints`.
 *
 * @throws If any endpoint reports a terminal failure or the timeout is exceeded.
 */
export async function pollAllWitnesses(
  endpoints: WitnessEndpoint[],
  chainId: number,
  blockNumber: number,
  logIndex: number,
  options: PollOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<Array<{ witness: WitnessPayload; signerIndex: number }>> {
  if (endpoints.length === 0) {
    throw new Error("pollAllWitnesses requires at least one endpoint");
  }

  const results = await Promise.all(
    endpoints.map(async (endpoint) => {
      const witness = await pollWitness(
        endpoint.url,
        chainId,
        blockNumber,
        logIndex,
        options,
        fetchFn,
      );
      return { witness, signerIndex: endpoint.signerIndex };
    }),
  );

  return results;
}

// ── Combined fetch + encode ───────────────────────────────────────────────────

/**
 * High-level helper: polls all witness endpoints until ready, then encodes
 * the combined proofs into the Vow binary format in a single call.
 *
 * This is the most common entry point for consumers who want to go from
 * (chainId, blockNumber, logIndex) to a Vow payload ready for `processVow`.
 *
 * For more granular control (e.g. caching individual proofs, showing per-
 * witness progress), use {@link pollAllWitnesses} + {@link encodeVow} directly.
 *
 * @param endpoints   - Witness endpoints to query.
 * @param chainId     - Numeric EVM chain ID.
 * @param blockNumber - Block number of the event.
 * @param logIndex    - Log index within the block.
 * @param options     - Polling options.
 * @param fetchFn     - Optional fetch replacement.
 * @returns The encoded Vow payload as a `0x`-prefixed hex string.
 */
export async function fetchAndEncodeVow(
  endpoints: WitnessEndpoint[],
  chainId: number,
  blockNumber: number,
  logIndex: number,
  options: PollOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<Hex> {
  const signedWitnesses = await pollAllWitnesses(
    endpoints,
    chainId,
    blockNumber,
    logIndex,
    options,
    fetchFn,
  );

  return encodeVow(signedWitnesses);
}
