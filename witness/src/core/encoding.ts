import { type Address, type Hex, toBytes, toHex, keccak256 } from "viem";

export function encodeEvent(
  emitter: Address,
  topics: Hex[],
  data: Hex
): Uint8Array {
  const emitterBytes = toBytes(emitter); // 20 bytes

  // topic_count: uint8, 1 byte
  const topicCountBytes = new Uint8Array([topics.length]);

  const topicBytesArr = topics.map((t) => toBytes(t)); // each 32 bytes
  const dataBytes = toBytes(data);

  const totalLength = 20 + 1 + topics.length * 32 + dataBytes.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;

  result.set(emitterBytes, offset);
  offset += 20;

  result.set(topicCountBytes, offset);
  offset += 1;

  for (const tb of topicBytesArr) {
    result.set(tb, offset);
    offset += 32;
  }

  result.set(dataBytes, offset);

  return result;
}

export function computeLeafHash(canonicalBytes: Uint8Array): Hex {
  const inner = keccak256(canonicalBytes);
  return keccak256(inner);
}

export function decodeEvent(canonicalBytes: Uint8Array): {
  emitter: Address;
  topics: Hex[];
  data: Hex;
} {
  let offset = 0;

  const emitterBytes = canonicalBytes.slice(offset, offset + 20);
  offset += 20;
  const emitter = toHex(emitterBytes) as Address;

  const topicCount = canonicalBytes[offset]!;
  offset += 1;

  const topics: Hex[] = [];
  for (let i = 0; i < topicCount; i++) {
    const topicBytes = canonicalBytes.slice(offset, offset + 32);
    offset += 32;
    topics.push(toHex(topicBytes) as Hex);
  }

  const dataBytes = canonicalBytes.slice(offset);
  const data = toHex(dataBytes) as Hex;

  return { emitter, topics, data };
}
