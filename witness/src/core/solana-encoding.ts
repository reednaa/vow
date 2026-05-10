import { type Hex, toHex, keccak256 } from "viem";
import bs58 from "bs58";

export const EVENT_IX_TAG = new Uint8Array([
  0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d,
]);

/**
 * Canonical event encoding for Solana emit_cpi!() events.
 * Layout: programId (32 bytes) | discriminator (8 bytes) | borshEventData (N bytes)
 *
 * Matches VowLib.decodeEmitCPI() canonical format.
 * Total length: 40 + data.length bytes.
 */
export function encodeSolanaEvent(
  programId: Uint8Array,
  discriminator: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(32 + 8 + data.length);
  result.set(programId, 0);
  result.set(discriminator, 32);
  result.set(data, 40);
  return result;
}

/**
 * Double keccak256 leaf hash: keccak256(keccak256(canonicalBytes)).
 * Same algorithm as EVM's computeLeafHash — cross-chain consistent.
 */
export function computeSolanaLeafHash(canonicalBytes: Uint8Array): Hex {
  const inner = keccak256(canonicalBytes);
  return keccak256(inner);
}

/**
 * Decode canonical bytes back into components.
 * Reverse of encodeSolanaEvent.
 */
export function decodeSolanaEvent(canonicalBytes: Uint8Array): {
  programId: Uint8Array;
  discriminator: Uint8Array;
  data: Uint8Array;
} {
  if (canonicalBytes.length < 40) {
    throw new Error(`Invalid canonical event: expected >= 40 bytes, got ${canonicalBytes.length}`);
  }
  return {
    programId: canonicalBytes.slice(0, 32),
    discriminator: canonicalBytes.slice(32, 40),
    data: canonicalBytes.slice(40),
  };
}

/**
 * Check if an inner instruction is an emit_cpi!() event.
 *
 * Two signals must both be present:
 * 1. Self-CPI: inner ix program matches parent ix program
 * 2. EVENT_IX_TAG: instruction data starts with sha256("anchor:event")[0..8]
 *
 * @param innerData - base58-encoded inner instruction data
 * @param innerProgram - base58-encoded inner ix program ID
 * @param parentProgram - base58-encoded parent ix program ID
 */
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

/**
 * Extract canonical encoding components from a detected emit_cpi!() instruction.
 *
 * @param innerData - base58-encoded inner instruction data (with 8-byte EVENT_IX_TAG prefix)
 * @param programId - 32-byte program public key
 * @returns { discriminator, data, canonicalBytes, leafHash }
 */
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
  // Skip EVENT_IX_TAG (8 bytes), then discriminator (8 bytes), rest is borsh data
  const discriminator = bytes.slice(8, 16);
  const data = bytes.slice(16);
  const canonicalBytes = encodeSolanaEvent(programId, discriminator, data);
  const leafHash = computeSolanaLeafHash(canonicalBytes);
  return { discriminator, data, canonicalBytes, leafHash };
}
