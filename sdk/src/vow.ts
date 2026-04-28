/**
 * Vow binary encoding and decoding.
 *
 * The Vow binary format is the payload passed to `VowLib.processVow(directory, vow)`
 * on-chain. It packs the Merkle proof, signer indices, signatures, and canonical
 * event bytes into a compact binary layout.
 *
 * Layout (total = 68 + P×32 + S + Σ(2 + sigLen_i) + E bytes):
 *
 *   Offset  Size     Field
 *   ──────────────────────────────────────────────────────────────────────
 *    0      32 B     chainId          (uint256, big-endian)
 *   32      32 B     rootBlockNumber  (uint256, big-endian)
 *   64       1 B     P                (proof node count, uint8)
 *   65       1 B     S                (signer count, uint8)
 *   66       2 B     E                (event bytes length, uint16 big-endian)
 *   68     P×32 B    proof[]          (each node is bytes32)
 *   68+P×32  S B     signerIndices[]  (each uint8, strictly increasing, 1–255)
 *   68+P×32+S        signatures[]     (for each: 2-byte big-endian length + sig bytes)
 *   TOTAL-E  E B     eventBytes       (canonical event encoding)
 *
 * Key invariants enforced by encodeVow:
 * - All witnesses must agree on chainId, rootBlockNumber, and the event.
 * - signerIndex values must be unique; they are sorted ascending before encoding.
 * - signerIndex must be 1–255 (0 is reserved as a sentinel in the directory).
 */

import { type Address, type Hex, toBytes, toHex } from "viem";
import { decodeEvent, encodeEvent } from "./encoding.js";
import type { DecodedVow, RawEvent, SignedWitness } from "./types.js";

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Writes a bigint as a 32-byte big-endian value into buf at offset. */
function writePad32(buf: Uint8Array, offset: number, value: bigint): void {
  let v = value;
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/** Reads a 32-byte big-endian value from buf at offset as a bigint. */
function readPad32(buf: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 32; i++) {
    v = (v << 8n) | BigInt(buf[offset + i]!);
  }
  return v;
}

// ── Validation helpers ────────────────────────────────────────────────────────

function eventsEqual(a: RawEvent, b: RawEvent): boolean {
  return (
    a.emitter.toLowerCase() === b.emitter.toLowerCase() &&
    a.topics.length === b.topics.length &&
    a.topics.every((t, i) => t.toLowerCase() === b.topics[i]!.toLowerCase()) &&
    a.data.toLowerCase() === b.data.toLowerCase()
  );
}

// ── encodeVow ─────────────────────────────────────────────────────────────────

/**
 * Encodes one or more signed witness proofs into the binary Vow format
 * accepted by `VowLib.processVow(directory, vowBytes)`.
 *
 * This is a pure, stateless function. It performs the following:
 * 1. Validates that all witnesses attest to the same event on the same chain.
 * 2. Sorts witnesses by `signerIndex` ascending and checks uniqueness.
 * 3. Packs the binary payload with the Merkle proof from the first witness
 *    (all valid witnesses must produce the same proof for the same event).
 *
 * @param witnesses - One or more signed witness proofs. At least one required.
 * @returns The Vow payload as a `0x`-prefixed hex string.
 *
 * @throws If no witnesses are provided.
 * @throws If witnesses disagree on chainId, rootBlockNumber, or the event.
 * @throws If any signerIndex is 0 or duplicate.
 */
export function encodeVow(witnesses: SignedWitness[]): Hex {
  if (witnesses.length === 0) {
    throw new Error("encodeVow requires at least one witness");
  }

  const first = witnesses[0]!.witness;

  // Validate all witnesses agree on identity.
  for (let i = 1; i < witnesses.length; i++) {
    const w = witnesses[i]!.witness;
    if (w.chainId !== first.chainId) {
      throw new Error(
        `Witness ${i} has chainId ${w.chainId} but witness 0 has chainId ${first.chainId}`,
      );
    }
    if (w.rootBlockNumber !== first.rootBlockNumber) {
      throw new Error(
        `Witness ${i} has rootBlockNumber ${w.rootBlockNumber} but witness 0 has rootBlockNumber ${first.rootBlockNumber}`,
      );
    }
    if (!eventsEqual(w.event, first.event)) {
      throw new Error(
        `Witness ${i} attests to a different event than witness 0`,
      );
    }
  }

  // Sort by signerIndex ascending and check uniqueness.
  const sorted = [...witnesses].sort((a, b) => a.signerIndex - b.signerIndex);
  for (let i = 0; i < sorted.length; i++) {
    const idx = sorted[i]!.signerIndex;
    if (idx === 0) {
      throw new Error("signerIndex 0 is reserved; indices must be 1–255");
    }
    if (idx > 255) {
      throw new Error(
        `signerIndex ${idx} exceeds maximum of 255`,
      );
    }
    if (i > 0 && idx <= sorted[i - 1]!.signerIndex) {
      throw new Error(
        `Duplicate signerIndex ${idx}; all signer indices must be unique`,
      );
    }
  }

  const proof = first.proof;
  const eventBytes = encodeEvent(first.event.emitter, first.event.topics, first.event.data);

  const P = proof.length;
  const S = sorted.length;
  const E = eventBytes.length;

  const sigBytesArr = sorted.map((sw) => toBytes(sw.witness.signature));
  const sigsTotalLen = sigBytesArr.reduce((sum, b) => sum + 2 + b.length, 0);

  const total = 68 + P * 32 + S + sigsTotalLen + E;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  // Fixed header
  writePad32(buf, 0, BigInt(first.chainId));
  writePad32(buf, 32, BigInt(first.rootBlockNumber));
  buf[64] = P;
  buf[65] = S;
  view.setUint16(66, E, false); // big-endian

  // Proof nodes
  for (let i = 0; i < P; i++) {
    buf.set(toBytes(proof[i]!), 68 + i * 32);
  }

  let off = 68 + P * 32;

  // Signer indices (S bytes, each uint8)
  for (const sw of sorted) {
    buf[off++] = sw.signerIndex;
  }

  // Signatures (each: 2-byte big-endian length prefix + raw sig bytes)
  for (const sigBytes of sigBytesArr) {
    view.setUint16(off, sigBytes.length, false);
    off += 2;
    buf.set(sigBytes, off);
    off += sigBytes.length;
  }

  // Canonical event bytes
  buf.set(eventBytes, off);

  return toHex(buf);
}

// ── decodeVow ─────────────────────────────────────────────────────────────────

/**
 * Decodes a Vow binary payload back into its constituent parts.
 *
 * Inverse of {@link encodeVow}. Does not perform signature verification.
 * Useful for inspection, debugging, or constructing custom verification logic.
 *
 * @param vowHex - The Vow payload as a `0x`-prefixed hex string.
 * @returns The decoded fields.
 *
 * @throws If the buffer is shorter than the fixed header (68 bytes).
 * @throws If the encoded lengths cause reads past the end of the buffer.
 */
export function decodeVow(vowHex: Hex): DecodedVow {
  const buf = toBytes(vowHex);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (buf.length < 68) {
    throw new Error(
      `Vow payload too short: expected at least 68 bytes, got ${buf.length}`,
    );
  }

  const chainId = readPad32(buf, 0);
  const rootBlockNumber = readPad32(buf, 32);
  const P = buf[64]!;
  const S = buf[65]!;
  const E = view.getUint16(66, false); // big-endian

  const proofEnd = 68 + P * 32;
  if (buf.length < proofEnd + S) {
    throw new Error("Vow payload truncated in proof or signer-index section");
  }

  const proof: Hex[] = [];
  for (let i = 0; i < P; i++) {
    proof.push(toHex(buf.slice(68 + i * 32, 68 + (i + 1) * 32)) as Hex);
  }

  const signerIndices: number[] = [];
  let off = proofEnd;
  for (let i = 0; i < S; i++) {
    signerIndices.push(buf[off++]!);
  }

  const signatures: Hex[] = [];
  for (let i = 0; i < S; i++) {
    if (off + 2 > buf.length) {
      throw new Error(`Vow payload truncated reading signature length at index ${i}`);
    }
    const sigLen = view.getUint16(off, false);
    off += 2;
    if (off + sigLen > buf.length) {
      throw new Error(`Vow payload truncated reading signature data at index ${i}`);
    }
    signatures.push(toHex(buf.slice(off, off + sigLen)) as Hex);
    off += sigLen;
  }

  if (off + E > buf.length) {
    throw new Error("Vow payload truncated in event bytes section");
  }
  const eventBytes = buf.slice(off, off + E);

  return { chainId, rootBlockNumber, proof, signerIndices, signatures, eventBytes };
}

/**
 * Extracts and decodes the event from an encoded Vow payload without full
 * signature verification.
 *
 * Convenience wrapper around {@link decodeVow} + `decodeEvent`.
 *
 * @param vowHex - The Vow payload as a `0x`-prefixed hex string.
 * @returns The emitter address, topics array, and data.
 */
export function extractEventFromVow(vowHex: Hex): RawEvent {
  const { eventBytes } = decodeVow(vowHex);
  return decodeEvent(eventBytes);
}

/**
 * Extracts the signer-index bitmap from a Vow payload in the packed uint256
 * format expected by `IWitnessDirectory.getQourumSet`.
 *
 * The bitmap stores indices as 1-byte values starting from the most
 * significant byte: `byte 0 = indices[0], byte 1 = indices[1], …`,
 * terminated by a zero byte.
 *
 * @param vowHex - The Vow payload as a `0x`-prefixed hex string.
 * @returns The 32-byte packed index map as a `0x`-prefixed hex bigint string.
 */
export function extractSignerIndexMap(vowHex: Hex): Hex {
  const { signerIndices } = decodeVow(vowHex);

  const bitmap = new Uint8Array(32);
  for (let i = 0; i < signerIndices.length && i < 32; i++) {
    bitmap[i] = signerIndices[i]!;
  }

  return toHex(bitmap) as Hex;
}

// ── Merging proofs from different witness services ────────────────────────────

/**
 * Merges witness proofs from multiple independently-queried witness services
 * into a single `SignedWitness[]` array ready for {@link encodeVow}.
 *
 * This is the typical pattern for a consumer who queries witnesses separately
 * (e.g. using different polling strategies or caching) rather than using the
 * combined {@link fetchAndEncodeVow} flow:
 *
 * ```ts
 * const witnesses = mergeWitnessProofs([
 *   { witness: proofFromServiceA, signerIndex: 1 },
 *   { witness: proofFromServiceB, signerIndex: 2 },
 * ]);
 * const vowBytes = encodeVow(witnesses);
 * ```
 *
 * Validation (cross-witness consistency, index uniqueness) is performed by
 * {@link encodeVow} when you pass the result.
 *
 * @param signedWitnesses - Array of `{ witness, signerIndex }` pairs. Safe to
 *                          pass in any order — `encodeVow` sorts by index.
 * @returns The same array, validated for structural completeness only.
 *
 * @throws If the array is empty.
 * @throws If any entry is missing the witness or signerIndex field.
 */
export function mergeWitnessProofs(
  signedWitnesses: SignedWitness[],
): SignedWitness[] {
  if (signedWitnesses.length === 0) {
    throw new Error("mergeWitnessProofs requires at least one witness");
  }
  for (let i = 0; i < signedWitnesses.length; i++) {
    const sw = signedWitnesses[i]!;
    if (!sw.witness) {
      throw new Error(`Entry at index ${i} is missing the witness field`);
    }
    if (sw.signerIndex === undefined || sw.signerIndex === null) {
      throw new Error(`Entry at index ${i} is missing the signerIndex field`);
    }
  }
  return signedWitnesses;
}

// ── Typed return of processVow ABI ────────────────────────────────────────────

/**
 * Decodes the raw tuple returned by `VowLib.processVow` / `MockVowLib.processVow`
 * into a typed {@link ProcessVowResult}.
 *
 * Pass this the raw array value that `readContract` resolves to when calling
 * `processVow`.
 *
 * @param raw - The raw 5-element tuple `[chainId, rootBlockNumber, emitter, topics, data]`.
 * @returns Typed result with named fields.
 */
export function decodeProcessVowResult(
  raw: readonly [bigint, bigint, Address, readonly Hex[], Hex],
): { chainId: bigint; rootBlockNumber: bigint; emitter: Address; topics: Hex[]; data: Hex } {
  const [chainId, rootBlockNumber, emitter, topics, data] = raw;
  return { chainId, rootBlockNumber, emitter, topics: [...topics], data };
}
