import { type Hex, toBytes, toHex } from "viem";
import { caip2ToNumericChainId } from "./chain.js";
import { encodeEthereumEvent, encodeSolanaEvent } from "./events.js";
import type { SignedWitness, SolanaWitnessResult, WitnessResult } from "./types.js";

function writePad32(buf: Uint8Array, offset: number, value: bigint) {
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(value & 0xffn);
    value >>= 8n;
  }
}

function sameWitnessEvent(a: WitnessResult, b: WitnessResult): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "ethereum" && b.mode === "ethereum") {
    return (
      a.event.emitter.toLowerCase() === b.event.emitter.toLowerCase() &&
      a.event.topics.length === b.event.topics.length &&
      a.event.topics.every(
        (topic, index) => topic.toLowerCase() === b.event.topics[index]!.toLowerCase(),
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

function encodeWitnessEvent(witness: WitnessResult): Uint8Array {
  if (witness.mode === "ethereum") {
    return encodeEthereumEvent(witness.event.emitter, witness.event.topics, witness.event.data);
  }

  return encodeSolanaEvent(
    witness.event.programId,
    witness.event.discriminator,
    witness.event.data,
  );
}

export function mergeWitnesses(witnesses: SignedWitness[]): SignedWitness[] {
  if (witnesses.length === 0) {
    throw new Error("mergeWitnesses requires at least one witness");
  }

  const first = witnesses[0]!.witness;
  for (let i = 1; i < witnesses.length; i++) {
    const witness = witnesses[i]!.witness;
    if (witness.chainId !== first.chainId) {
      throw new Error("All witnesses must have the same chainId");
    }
    if (witness.rootBlockNumber !== first.rootBlockNumber) {
      throw new Error("All witnesses must have the same rootBlockNumber");
    }
    if (!sameWitnessEvent(first, witness)) {
      throw new Error("All witnesses must attest to the same event");
    }
  }

  const sorted = [...witnesses].sort((a, b) => a.signerIndex - b.signerIndex);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.signerIndex <= sorted[i - 1]!.signerIndex) {
      throw new Error("signerIndex values must be unique");
    }
  }

  return sorted;
}

export function encodeVow(witnesses: SignedWitness[]): Hex {
  const sorted = mergeWitnesses(witnesses);
  const first = sorted[0]!.witness;
  const proof = first.proof;
  const eventBytes = encodeWitnessEvent(first);

  const P = proof.length;
  const S = sorted.length;
  const E = eventBytes.length;

  const sigBytesArr = sorted.map((signedWitness) => toBytes(signedWitness.witness.signature));
  const sigsTotalLen = sigBytesArr.reduce((sum, sigBytes) => sum + 2 + sigBytes.length, 0);

  const total = 68 + P * 32 + S + sigsTotalLen + E;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  writePad32(buf, 0, caip2ToNumericChainId(first.chainId));
  writePad32(buf, 32, BigInt(first.rootBlockNumber));
  buf[64] = P;
  buf[65] = S;
  view.setUint16(66, E, false);

  for (let i = 0; i < P; i++) {
    buf.set(toBytes(proof[i]!), 68 + i * 32);
  }

  let off = 68 + P * 32;

  for (const signedWitness of sorted) {
    buf[off++] = signedWitness.signerIndex;
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
