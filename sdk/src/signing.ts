/**
 * EIP-712 signing structures for the Vow witness protocol.
 *
 * The Vow struct is signed with an empty EIP-712 domain — no name, version,
 * chainId, verifying contract, or salt. This means:
 *
 *   domainSeparator = keccak256(keccak256("EIP712Domain()"))
 *   structHash      = keccak256(VOW_TYPE_HASH ++ abi.encode(chainId, rootBlockNumber, root))
 *   digest          = keccak256("\x19\x01" ++ domainSeparator ++ structHash)
 *
 * where:
 *   VOW_TYPE_HASH = keccak256("Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)")
 *
 * The signature format is EIP-2098 compact (64 bytes), not the standard 65-byte
 * form. Compact signatures can be recovered on-chain by Solady's
 * `SignatureCheckerLib.isValidSignatureNowCalldata`.
 *
 * Functions in this module are all pure / stateless — signing itself requires
 * an external account (see the `SignVowFn` type).
 */

import {
  type Hex,
  compactSignatureToSignature,
  hashTypedData,
  parseCompactSignature,
  parseSignature,
  recoverAddress,
  serializeCompactSignature,
  signatureToCompactSignature,
} from "viem";
import type { VowSigningParams } from "./types.js";

// ── EIP-712 domain and types ──────────────────────────────────────────────────

/**
 * The EIP-712 domain for Vow signatures.
 * Empty object — no fields — produces `domainSeparator = keccak256(keccak256("EIP712Domain()"))`.
 */
export const VOW_DOMAIN = {} as const;

/**
 * The EIP-712 type definitions for the Vow struct.
 */
export const VOW_TYPES = {
  Vow: [
    { name: "chainId", type: "uint256" },
    { name: "rootBlockNumber", type: "uint256" },
    { name: "root", type: "bytes32" },
  ],
} as const;

/**
 * The EIP-712 primary type name for the Vow struct.
 */
export const VOW_PRIMARY_TYPE = "Vow" as const;

// ── Digest computation ────────────────────────────────────────────────────────

/**
 * Computes the EIP-712 digest that the witness signs over.
 *
 * This is the value passed to `eth_sign` / `personal_sign` equivalent under
 * EIP-712. It matches what `VowLib._hashTypedData(vowTypehash(...))` produces
 * in Solidity.
 *
 * @param params - The chain ID, root block number, and Merkle root to commit.
 * @returns 32-byte digest as a `0x`-prefixed hex string.
 */
export function computeVowDigest(params: VowSigningParams): Hex {
  return hashTypedData({
    domain: VOW_DOMAIN,
    types: VOW_TYPES,
    primaryType: VOW_PRIMARY_TYPE,
    message: {
      chainId: params.chainId,
      rootBlockNumber: params.rootBlockNumber,
      root: params.root,
    },
  });
}

// ── Signature helpers ─────────────────────────────────────────────────────────

/**
 * Converts a standard 65-byte ECDSA signature (`r || s || v`) to the
 * EIP-2098 compact 64-byte form (`r || yParityAndS`).
 *
 * The witness service stores and returns compact signatures; the on-chain
 * `SignatureCheckerLib` accepts both formats, but the canonical Vow binary
 * always uses compact form.
 *
 * @param fullSignature - The 65-byte (130 hex chars) signature string.
 * @returns 64-byte (128 hex chars) compact signature.
 */
export function toCompactSignature(fullSignature: Hex): Hex {
  return serializeCompactSignature(
    signatureToCompactSignature(parseSignature(fullSignature)),
  );
}

/**
 * Recovers the signer address from an EIP-712 Vow signature.
 *
 * Accepts both standard 65-byte and compact 64-byte signature formats.
 *
 * @param params    - The Vow params that were signed.
 * @param signature - The signature (64 or 65 bytes, `0x`-prefixed hex).
 * @returns The signer's Ethereum address.
 */
export async function recoverVowSigner(
  params: VowSigningParams,
  signature: Hex,
): Promise<`0x${string}`> {
  const digest = computeVowDigest(params);

  // Normalize: compact (64-byte / 130 hex chars including 0x prefix) → full
  const recoverableSignature =
    signature.length === 130
      ? compactSignatureToSignature(parseCompactSignature(signature))
      : parseSignature(signature);

  return recoverAddress({ hash: digest, signature: recoverableSignature });
}

// ── Sign function type ────────────────────────────────────────────────────────

/**
 * A function that signs a Vow struct and returns a compact (64-byte) signature.
 *
 * Pass an implementation of this type to functions that need signing instead
 * of providing a private key directly. This allows callers to use hardware
 * wallets, browser extensions, or any other signer without coupling to a
 * specific key management approach.
 *
 * The returned signature MUST be EIP-2098 compact (64 bytes). If your signer
 * returns a 65-byte signature, wrap it with {@link toCompactSignature}.
 *
 * @example
 * Using a viem `privateKeyToAccount`:
 * ```ts
 * import { privateKeyToAccount } from "viem/accounts";
 * import { toCompactSignature, VOW_DOMAIN, VOW_TYPES, VOW_PRIMARY_TYPE } from "vow-sdk/signing";
 *
 * const account = privateKeyToAccount("0x...");
 *
 * const signVow: SignVowFn = async (params) => {
 *   const sig = await account.signTypedData({
 *     domain: VOW_DOMAIN,
 *     types: VOW_TYPES,
 *     primaryType: VOW_PRIMARY_TYPE,
 *     message: {
 *       chainId: params.chainId,
 *       rootBlockNumber: params.rootBlockNumber,
 *       root: params.root,
 *     },
 *   });
 *   return toCompactSignature(sig);
 * };
 * ```
 *
 * @example
 * Using a browser wallet via viem `WalletClient`:
 * ```ts
 * import { toCompactSignature, VOW_DOMAIN, VOW_TYPES, VOW_PRIMARY_TYPE } from "vow-sdk/signing";
 *
 * const signVow: SignVowFn = async (params) => {
 *   const sig = await walletClient.signTypedData({
 *     account,
 *     domain: VOW_DOMAIN,
 *     types: VOW_TYPES,
 *     primaryType: VOW_PRIMARY_TYPE,
 *     message: {
 *       chainId: params.chainId,
 *       rootBlockNumber: params.rootBlockNumber,
 *       root: params.root,
 *     },
 *   });
 *   return toCompactSignature(sig);
 * };
 * ```
 */
export type SignVowFn = (params: VowSigningParams) => Promise<Hex>;
