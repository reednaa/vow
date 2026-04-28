/**
 * Sorted binary Merkle tree implementation used by the Vow witness protocol.
 *
 * Properties:
 * - Leaves are sorted ascending by numeric (BigInt) value before the tree is
 *   built, so the root is deterministic regardless of insertion order.
 * - Odd (unpaired) nodes at any level are promoted as-is to the next level
 *   (no zero-padding or duplication).
 * - Pair hashing uses sorted-pair keccak256:
 *     hashPair(a, b) = keccak256(lo ++ hi)   where lo <= hi numerically
 *   This matches Solady's `MerkleProofLib.verifyCalldata` used on-chain.
 * - An empty leaf set produces root = ZERO_HASH (`0x00…00`).
 *
 * The tree is stored as a 2D array (`MerkleTree = Hex[][]`) where:
 *   tree[0]          — sorted leaf layer
 *   tree[1..n-1]     — intermediate levels
 *   tree[n-1]        — `[root]`
 */

import { type Hex, keccak256, toBytes } from "viem";
import type { MerkleTree } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The zero hash used as the Merkle root when a block has no events.
 * Matches the sentinel used by the witness service worker.
 */
export const ZERO_HASH: Hex = `0x${"00".repeat(32)}` as Hex;

// ── Internal helpers ──────────────────────────────────────────────────────────

function sortPair(a: Hex, b: Hex): [Hex, Hex] {
  return BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
}

/**
 * Computes `keccak256(lo ++ hi)` where `lo` is the numerically smaller of
 * the two 32-byte values. Matches the on-chain `VowLib.computeMerkleRootCalldata`
 * algorithm.
 */
export function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = sortPair(a, b);
  const combined = new Uint8Array(64);
  combined.set(toBytes(lo), 0);
  combined.set(toBytes(hi), 32);
  return keccak256(combined);
}

// ── Tree construction ─────────────────────────────────────────────────────────

/**
 * Builds a sorted binary Merkle tree from a set of leaf hashes.
 *
 * The leaves are first sorted ascending by numeric value, then paired
 * bottom-up. Unpaired (odd) nodes are promoted as-is.
 *
 * @param leaves - Array of 32-byte leaf hashes (output of `computeLeafHash`).
 *                 May be empty; an empty array produces `root = ZERO_HASH`.
 * @returns `{ root, tree }` where `tree[0]` is the sorted leaf layer and
 *          `tree[tree.length - 1]` is `[root]`.
 */
export function buildMerkleTree(leaves: Hex[]): { root: Hex; tree: MerkleTree } {
  if (leaves.length === 0) {
    return { root: ZERO_HASH, tree: [[ZERO_HASH]] };
  }

  const sorted = [...leaves].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  );

  const tree: MerkleTree = [sorted];
  let current = sorted;

  while (current.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i]!, current[i + 1]!));
      } else {
        // Odd node: promote as-is — no sibling, no padding.
        next.push(current[i]!);
      }
    }
    tree.push(next);
    current = next;
  }

  return { root: current[0]!, tree };
}

// ── Proof generation ──────────────────────────────────────────────────────────

/**
 * Generates a Merkle inclusion proof for the leaf at the given index in the
 * sorted leaf layer (`tree[0]`).
 *
 * The proof is an array of sibling hashes, one per level that has a sibling.
 * Levels where a node is promoted (odd node with no sibling) contribute no
 * entry to the proof, which matches the on-chain verifier's behaviour.
 *
 * @param tree      - A tree previously built by {@link buildMerkleTree}.
 * @param leafIndex - The position of the target leaf in `tree[0]` (0-indexed).
 * @returns An array of sibling hashes to submit alongside the leaf.
 *
 * @throws If `leafIndex` is out of bounds.
 */
export function generateProof(tree: MerkleTree, leafIndex: number): Hex[] {
  const leafLayer = tree[0];
  if (!leafLayer || leafIndex < 0 || leafIndex >= leafLayer.length) {
    throw new Error(
      `leafIndex ${leafIndex} out of bounds for tree with ${leafLayer?.length ?? 0} leaves`,
    );
  }

  const proof: Hex[] = [];
  let index = leafIndex;

  for (let level = 0; level < tree.length - 1; level++) {
    const levelNodes = tree[level]!;
    const siblingIndex = index ^ 1; // XOR with 1 flips between even/odd

    if (siblingIndex < levelNodes.length) {
      // Sibling exists at this level — include it in the proof.
      proof.push(levelNodes[siblingIndex]!);
    }
    // If no sibling (odd unpaired node), skip — node is promoted as-is.

    index = Math.floor(index / 2);
  }

  return proof;
}

// ── Proof verification ────────────────────────────────────────────────────────

/**
 * Verifies that a leaf is included in a Merkle tree with the given root.
 *
 * Recomputes the root by hashing the leaf with each proof sibling in order,
 * then compares against the expected root. Case-insensitive hex comparison.
 *
 * This matches the algorithm in `VowLib.computeMerkleRootCalldata` on-chain.
 *
 * @param root  - The expected Merkle root.
 * @param leaf  - The leaf to verify (32-byte hash).
 * @param proof - The sibling hashes returned by {@link generateProof}.
 * @returns `true` if the proof is valid for this root and leaf.
 */
export function verifyProof(root: Hex, leaf: Hex, proof: Hex[]): boolean {
  let current = leaf;
  for (const sibling of proof) {
    current = hashPair(current, sibling);
  }
  return current.toLowerCase() === root.toLowerCase();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Returns the sorted leaf index of a given leaf hash within a built tree.
 *
 * Useful for looking up a leaf's position after building the tree, so you
 * can then call {@link generateProof}.
 *
 * @param tree     - A tree previously built by {@link buildMerkleTree}.
 * @param leafHash - The leaf hash to locate.
 * @returns The zero-based index in `tree[0]`, or `-1` if not found.
 */
export function findLeafIndex(tree: MerkleTree, leafHash: Hex): number {
  const leafLayer = tree[0] ?? [];
  return leafLayer.findIndex(
    (l) => l.toLowerCase() === leafHash.toLowerCase(),
  );
}
