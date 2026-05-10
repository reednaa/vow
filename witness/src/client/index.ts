import { type Address, type Hex, toBytes, toHex } from "viem";
import { encodeEvent } from "../core/encoding.ts";
import { caip2ToNumericChainId } from "../core/chain-utils.ts";

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimized witness response — just the fields needed to encode a Vow */
export interface WitnessResult {
  chainId: string;
  rootBlockNumber: number;
  proof: Hex[];
  signature: Hex;
  event: { emitter: Address; topics: Hex[]; data: Hex };
}

/** A witness result paired with its signer's index in the on-chain WitnessDirectory */
export interface SignedWitness {
  witness: WitnessResult;
  signerIndex: number; // 1-255
}

export interface WitnessEndpoint {
  url: string;
  signerIndex: number;
}

export interface FetchOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writePad32(buf: Uint8Array, offset: number, value: bigint) {
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(value & 0xffn);
    value >>= 8n;
  }
}

// ── encodeVow ────────────────────────────────────────────────────────────────

/**
 * Pure function. Encodes 1+ witness results into the binary Vow format
 * accepted by `VowLib.processVow()`.
 *
 * Layout:
 * [chainId:32B][rootBlockNumber:32B][P:1B][S:1B][E:2B]
 * [proof: P×32B]
 * [signerIndices: S×1B]
 * [signatures: S×(2B length + sigBytes)]
 * [eventBytes: E bytes]
 */
export function encodeVow(witnesses: SignedWitness[]): Hex {
  if (witnesses.length === 0) {
    throw new Error("encodeVow requires at least one witness");
  }

  const first = witnesses[0]!.witness;

  // Validate all witnesses agree on event identity
  for (let i = 1; i < witnesses.length; i++) {
    const w = witnesses[i]!.witness;
    if (w.chainId !== first.chainId) {
      throw new Error("All witnesses must have the same chainId");
    }
    if (w.rootBlockNumber !== first.rootBlockNumber) {
      throw new Error("All witnesses must have the same rootBlockNumber");
    }
    if (
      w.event.emitter.toLowerCase() !== first.event.emitter.toLowerCase() ||
      w.event.topics.length !== first.event.topics.length ||
      w.event.topics.some(
        (t, j) => t.toLowerCase() !== first.event.topics[j]!.toLowerCase()
      ) ||
      w.event.data.toLowerCase() !== first.event.data.toLowerCase()
    ) {
      throw new Error("All witnesses must attest to the same event");
    }
  }

  // Sort by signerIndex ascending and check uniqueness
  const sorted = [...witnesses].sort(
    (a, b) => a.signerIndex - b.signerIndex
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.signerIndex <= sorted[i - 1]!.signerIndex) {
      throw new Error("signerIndex values must be unique");
    }
  }

  const proof = first.proof;
  const eventBytes = encodeEvent(
    first.event.emitter,
    first.event.topics,
    first.event.data
  );

  const P = proof.length;
  const S = sorted.length;
  const E = eventBytes.length;

  const sigBytesArr = sorted.map((sw) => toBytes(sw.witness.signature));
  const sigsTotalLen = sigBytesArr.reduce((sum, b) => sum + 2 + b.length, 0);

  const total = 68 + P * 32 + S + sigsTotalLen + E;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  // Header
  writePad32(buf, 0, caip2ToNumericChainId(first.chainId));
  writePad32(buf, 32, BigInt(first.rootBlockNumber));
  buf[64] = P;
  buf[65] = S;
  view.setUint16(66, E, false); // big-endian

  // Proof
  for (let i = 0; i < P; i++) {
    buf.set(toBytes(proof[i]!), 68 + i * 32);
  }

  let off = 68 + P * 32;

  // Signer indices
  for (const sw of sorted) {
    buf[off++] = sw.signerIndex;
  }

  // Signatures
  for (const sigBytes of sigBytesArr) {
    view.setUint16(off, sigBytes.length, false);
    off += 2;
    buf.set(sigBytes, off);
    off += sigBytes.length;
  }

  // Event
  buf.set(eventBytes, off);

  return toHex(buf);
}

// ── fetchAndEncodeVow ────────────────────────────────────────────────────────

/**
 * Fetches witness proofs from multiple endpoints, polls until all are ready,
 * and returns the encoded Vow payload.
 */
export async function fetchAndEncodeVow(
  endpoints: WitnessEndpoint[],
  caip2ChainId: string,
  blockNumber: number,
  logIndex: number,
  options: FetchOptions = {}
): Promise<Hex> {
  const { pollIntervalMs = 1000, timeoutMs = 30000 } = options;
  const deadline = Date.now() + timeoutMs;

  const results: (WitnessResult | null)[] = endpoints.map(() => null);

  while (Date.now() < deadline) {
    const pending: number[] = [];
    for (let i = 0; i < endpoints.length; i++) {
      if (!results[i]) pending.push(i);
    }

    const responses = await Promise.all(
      pending.map(async (i) => {
        const ep = endpoints[i]!;
        const url = `${ep.url}/witness/${caip2ChainId}/${blockNumber}/${logIndex}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Witness endpoint ${ep.url} returned ${res.status}`);
        }
        return { index: i, body: (await res.json()) as any };
      })
    );

    for (const { index, body } of responses) {
      if (body.status === "failed") {
        throw new Error(
          `Witness endpoint ${endpoints[index]!.url} failed: ${body.error}`
        );
      }
      if (body.status === "ready") {
        results[index] = body.witness as WitnessResult;
      }
      // "pending" / "indexing" → keep polling
    }

    if (results.every((r) => r !== null)) {
      const signed: SignedWitness[] = endpoints.map((ep, i) => ({
        witness: results[i]!,
        signerIndex: ep.signerIndex,
      }));
      return encodeVow(signed);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for witness proofs`);
}
