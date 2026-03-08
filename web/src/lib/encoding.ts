import { type Address, type Hex, toBytes, toHex } from "viem";
import type { SignedWitness } from "./types.js";

function encodeEvent(emitter: Address, topics: Hex[], data: Hex): Uint8Array {
  const emitterBytes = toBytes(emitter); // 20 bytes
  const topicBytesArr = topics.map((t) => toBytes(t)); // each 32 bytes
  const dataBytes = toBytes(data);

  const totalLength = 20 + 1 + topics.length * 32 + dataBytes.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;

  result.set(emitterBytes, offset);
  offset += 20;

  result[offset] = topics.length;
  offset += 1;

  for (const tb of topicBytesArr) {
    result.set(tb, offset);
    offset += 32;
  }

  result.set(dataBytes, offset);

  return result;
}

function writePad32(buf: Uint8Array, offset: number, value: bigint) {
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(value & 0xffn);
    value >>= 8n;
  }
}

/**
 * Encodes 1+ witness results into the binary Vow format accepted by
 * `VowLib.processVow()`.
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

  const sorted = [...witnesses].sort((a, b) => a.signerIndex - b.signerIndex);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.signerIndex <= sorted[i - 1]!.signerIndex) {
      throw new Error("signerIndex values must be unique");
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

  writePad32(buf, 0, BigInt(first.chainId));
  writePad32(buf, 32, BigInt(first.rootBlockNumber));
  buf[64] = P;
  buf[65] = S;
  view.setUint16(66, E, false); // big-endian

  for (let i = 0; i < P; i++) {
    buf.set(toBytes(proof[i]!), 68 + i * 32);
  }

  let off = 68 + P * 32;

  for (const sw of sorted) {
    buf[off++] = sw.signerIndex;
  }

  for (const sigBytes of sigBytesArr) {
    view.setUint16(off, sigBytes.length, false);
    off += 2;
    buf.set(sigBytes, off);
    off += sigBytes.length;
  }

  buf.set(eventBytes, off);

  return toHex(buf);
}
