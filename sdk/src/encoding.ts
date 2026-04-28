/**
 * Canonical event encoding used by the Vow witness protocol.
 *
 * The canonical format is identical to what Solidity's `VowLib.encodeEvent`
 * produces and what the witness service stores in its database:
 *
 *   [emitter: 20 bytes]
 *   [topicCount: uint8, 1 byte]
 *   [topics: topicCount × 32 bytes]
 *   [data: variable length]
 *
 * Total: 21 + topicCount × 32 + len(data) bytes.
 *
 * The leaf hash used in the Merkle tree is the double-keccak256 of these bytes:
 *   leafHash = keccak256(keccak256(canonicalBytes))
 *
 * This double-hash prevents second-preimage attacks on the tree nodes.
 */

import { type Address, type Hex, keccak256, toBytes, toHex } from "viem";
import type { RawEvent } from "./types.js";

// ── Encoding ──────────────────────────────────────────────────────────────────

/**
 * Encodes an EVM log event into the canonical Vow binary format.
 *
 * The result is the pre-image for `computeLeafHash` and is what the witness
 * service stores in its `indexed_events.canonical_bytes` column.
 *
 * @param emitter - The address of the contract that emitted the log.
 * @param topics  - The log topics (event signature + indexed params), each 32 B.
 * @param data    - The non-indexed event data, arbitrary length.
 * @returns Raw canonical bytes as a `Uint8Array`.
 */
export function encodeEvent(
  emitter: Address,
  topics: Hex[],
  data: Hex,
): Uint8Array {
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

/**
 * Convenience overload — encode a {@link RawEvent} object directly.
 */
export function encodeRawEvent(event: RawEvent): Uint8Array {
  return encodeEvent(event.emitter, event.topics, event.data);
}

// ── Decoding ──────────────────────────────────────────────────────────────────

/**
 * Decodes canonical event bytes back into its constituent fields.
 *
 * Inverse of {@link encodeEvent}.
 *
 * @param canonicalBytes - The canonical event bytes (output of `encodeEvent`).
 * @returns The decoded emitter address, topics array, and data hex string.
 *
 * @throws If the byte slice is too short or the topic count is out of range.
 */
export function decodeEvent(canonicalBytes: Uint8Array): RawEvent {
  if (canonicalBytes.length < 21) {
    throw new Error(
      `Canonical bytes too short: expected at least 21 bytes, got ${canonicalBytes.length}`,
    );
  }

  let offset = 0;

  const emitterBytes = canonicalBytes.slice(offset, offset + 20);
  offset += 20;
  const emitter = toHex(emitterBytes) as Address;

  const topicCount = canonicalBytes[offset]!;
  offset += 1;

  if (topicCount > 4) {
    throw new Error(
      `Invalid canonical bytes: topic count ${topicCount} exceeds maximum of 4`,
    );
  }

  const minLength = 21 + topicCount * 32;
  if (canonicalBytes.length < minLength) {
    throw new Error(
      `Canonical bytes too short for ${topicCount} topics: expected at least ${minLength} bytes, got ${canonicalBytes.length}`,
    );
  }

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

// ── Leaf hash ─────────────────────────────────────────────────────────────────

/**
 * Computes the Merkle leaf hash for a canonical event byte sequence.
 *
 * The leaf hash is `keccak256(keccak256(canonicalBytes))` — a double-hash
 * that matches `VowLib._leafHash` in Solidity and prevents second-preimage
 * attacks on the Merkle tree nodes.
 *
 * @param canonicalBytes - Output of {@link encodeEvent} or raw bytes from DB.
 * @returns The 32-byte leaf hash as a `0x`-prefixed hex string.
 */
export function computeLeafHash(canonicalBytes: Uint8Array): Hex {
  const inner = keccak256(canonicalBytes);
  return keccak256(inner);
}

/**
 * Convenience: encode an event and immediately compute its leaf hash.
 *
 * Equivalent to `computeLeafHash(encodeEvent(emitter, topics, data))`.
 */
export function computeEventLeafHash(
  emitter: Address,
  topics: Hex[],
  data: Hex,
): Hex {
  return computeLeafHash(encodeEvent(emitter, topics, data));
}
