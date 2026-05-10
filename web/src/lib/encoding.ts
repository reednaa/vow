import { type Address, type Hex, toBytes, toHex } from "viem";
import { caip2ToNumericChainId } from "./chain.js";
import type { SignedWitness, SolanaWitnessResult } from "./types.js";

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

function encodeSolanaEvent(programId: Hex, discriminator: Hex, data: Hex): Uint8Array {
  const programIdBytes = toBytes(programId);
  const discriminatorBytes = toBytes(discriminator);
  const dataBytes = toBytes(data);

  const result = new Uint8Array(40 + dataBytes.length);
  result.set(programIdBytes, 0);
  result.set(discriminatorBytes, 32);
  result.set(dataBytes, 40);
  return result;
}

function sameWitnessEvent(a: SignedWitness["witness"], b: SignedWitness["witness"]): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "ethereum" && b.mode === "ethereum") {
    return (
      a.event.emitter.toLowerCase() === b.event.emitter.toLowerCase() &&
      a.event.topics.length === b.event.topics.length &&
      a.event.topics.every(
        (topic, index) => topic.toLowerCase() === b.event.topics[index]!.toLowerCase()
      ) &&
      a.event.data.toLowerCase() === b.event.data.toLowerCase()
    );
  }

  const solanaA = a as SolanaWitnessResult;
  const solanaB = b as SolanaWitnessResult;
  return (
    solanaA.event.programId.toLowerCase() === solanaB.event.programId.toLowerCase() &&
    solanaA.event.discriminator.toLowerCase() === solanaB.event.discriminator.toLowerCase() &&
    solanaA.event.data.toLowerCase() === solanaB.event.data.toLowerCase()
  );
}

function encodeWitnessEvent(witness: SignedWitness["witness"]): Uint8Array {
  if (witness.mode === "ethereum") {
    return encodeEvent(witness.event.emitter, witness.event.topics, witness.event.data);
  }
  return encodeSolanaEvent(
    witness.event.programId,
    witness.event.discriminator,
    witness.event.data
  );
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
    if (!sameWitnessEvent(first, w)) {
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
  const eventBytes = encodeWitnessEvent(first);

  const P = proof.length;
  const S = sorted.length;
  const E = eventBytes.length;

  const sigBytesArr = sorted.map((sw) => toBytes(sw.witness.signature));
  const sigsTotalLen = sigBytesArr.reduce((sum, b) => sum + 2 + b.length, 0);

  const total = 68 + P * 32 + S + sigsTotalLen + E;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  writePad32(buf, 0, caip2ToNumericChainId(first.chainId));
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
