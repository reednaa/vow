import { type Address, type Hex, keccak256, toBytes, toHex } from "viem";
import bs58 from "bs58";
import type { DecodedEthereumEvent, DecodedSolanaEvent } from "./types.js";

export const EVENT_IX_TAG = new Uint8Array([
  0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d,
]);

export function encodeEthereumEvent(
  emitter: Address,
  topics: Hex[],
  data: Hex,
): Uint8Array {
  const emitterBytes = toBytes(emitter);
  const topicBytesArr = topics.map((topic) => toBytes(topic));
  const dataBytes = toBytes(data);

  const result = new Uint8Array(20 + 1 + topics.length * 32 + dataBytes.length);
  let offset = 0;

  result.set(emitterBytes, offset);
  offset += 20;

  result[offset] = topics.length;
  offset += 1;

  for (const topicBytes of topicBytesArr) {
    result.set(topicBytes, offset);
    offset += 32;
  }

  result.set(dataBytes, offset);
  return result;
}

export function decodeEthereumEvent(canonicalBytes: Uint8Array): DecodedEthereumEvent {
  let offset = 0;

  const emitterBytes = canonicalBytes.slice(offset, offset + 20);
  offset += 20;

  const topicCount = canonicalBytes[offset]!;
  offset += 1;

  const topics: Hex[] = [];
  for (let i = 0; i < topicCount; i++) {
    const topicBytes = canonicalBytes.slice(offset, offset + 32);
    offset += 32;
    topics.push(toHex(topicBytes) as Hex);
  }

  return {
    emitter: toHex(emitterBytes) as Address,
    topics,
    data: toHex(canonicalBytes.slice(offset)) as Hex,
  };
}

export function encodeSolanaEvent(
  programId: Uint8Array | Hex,
  discriminator: Uint8Array | Hex,
  data: Uint8Array | Hex,
): Uint8Array {
  const programIdBytes = typeof programId === "string" ? toBytes(programId) : programId;
  const discriminatorBytes =
    typeof discriminator === "string" ? toBytes(discriminator) : discriminator;
  const dataBytes = typeof data === "string" ? toBytes(data) : data;

  const result = new Uint8Array(40 + dataBytes.length);
  result.set(programIdBytes, 0);
  result.set(discriminatorBytes, 32);
  result.set(dataBytes, 40);
  return result;
}

export function decodeSolanaEvent(canonicalBytes: Uint8Array): DecodedSolanaEvent {
  if (canonicalBytes.length < 40) {
    throw new Error(`Invalid canonical event: expected >= 40 bytes, got ${canonicalBytes.length}`);
  }

  return {
    programId: toHex(canonicalBytes.slice(0, 32)) as Hex,
    discriminator: toHex(canonicalBytes.slice(32, 40)) as Hex,
    data: toHex(canonicalBytes.slice(40)) as Hex,
  };
}

export function computeLeafHash(canonicalBytes: Uint8Array): Hex {
  const inner = keccak256(canonicalBytes);
  return keccak256(inner);
}

export function isEmitCpi(
  innerData: string,
  innerProgram: string,
  parentProgram: string,
): boolean {
  if (innerProgram !== parentProgram) return false;

  const bytes = bs58.decode(innerData);
  if (bytes.length < 8) return false;

  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== EVENT_IX_TAG[i]) return false;
  }
  return true;
}

export function extractEmitCpiEncoding(
  innerData: string,
  programId: Uint8Array,
): {
  discriminator: Uint8Array;
  data: Uint8Array;
  canonicalBytes: Uint8Array;
  leafHash: Hex;
} {
  const bytes = bs58.decode(innerData);
  const discriminator = bytes.slice(8, 16);
  const data = bytes.slice(16);
  const canonicalBytes = encodeSolanaEvent(programId, discriminator, data);
  const leafHash = computeLeafHash(canonicalBytes);

  return { discriminator, data, canonicalBytes, leafHash };
}
