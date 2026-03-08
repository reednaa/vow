import { describe, it, expect } from "bun:test";
import { type Hex, keccak256, toBytes, toHex } from "viem";
import { buildMerkleTree, generateProof, verifyProof } from "../src/core/merkle";

function makeLeaf(n: number): Hex {
  const b = new Uint8Array(32);
  b[31] = n;
  return toHex(b) as Hex;
}

function makeLeaves(count: number): Hex[] {
  return Array.from({ length: count }, (_, i) => makeLeaf(i + 1));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!; a[i] = a[j]!; a[j] = tmp;
  }
  return a;
}

describe("buildMerkleTree", () => {
  it("1 leaf: root equals the leaf, proof is empty", () => {
    const leaf = makeLeaf(42);
    const { root, tree } = buildMerkleTree([leaf]);
    expect(root.toLowerCase()).toBe(leaf.toLowerCase());
    const proof = generateProof(tree, 0);
    expect(proof).toEqual([]);
    expect(verifyProof(root, leaf, proof)).toBe(true);
  });

  it("2 leaves: root is hash of sorted pair, proof has 1 element", () => {
    const leaves = makeLeaves(2);
    const { root, tree } = buildMerkleTree(leaves);
    const sorted = [...leaves].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    const [lo, hi] =
      BigInt(sorted[0]!) <= BigInt(sorted[1]!)
        ? [sorted[0]!, sorted[1]!]
        : [sorted[1]!, sorted[0]!];
    const combined = new Uint8Array(64);
    combined.set(toBytes(lo), 0);
    combined.set(toBytes(hi), 32);
    const expectedRoot = keccak256(combined);
    expect(root.toLowerCase()).toBe(expectedRoot.toLowerCase());

    for (let i = 0; i < 2; i++) {
      const proof = generateProof(tree, i);
      expect(proof.length).toBe(1);
      expect(verifyProof(root, tree[0]![i]!, proof)).toBe(true);
    }
  });

  it("3 leaves: unpaired node promotes correctly, all proofs valid", () => {
    const leaves = makeLeaves(3);
    const { root, tree } = buildMerkleTree(leaves);
    for (let i = 0; i < 3; i++) {
      expect(verifyProof(root, tree[0]![i]!, generateProof(tree, i))).toBe(true);
    }
  });

  it("4 leaves: fully balanced tree, all proofs valid", () => {
    const leaves = makeLeaves(4);
    const { root, tree } = buildMerkleTree(leaves);
    for (let i = 0; i < 4; i++) {
      expect(verifyProof(root, tree[0]![i]!, generateProof(tree, i))).toBe(true);
    }
  });

  it("7 leaves: multiple odd levels, all proofs valid", () => {
    const leaves = makeLeaves(7);
    const { root, tree } = buildMerkleTree(leaves);
    for (let i = 0; i < 7; i++) {
      expect(verifyProof(root, tree[0]![i]!, generateProof(tree, i))).toBe(true);
    }
  });

  it("16 leaves: larger balanced tree, all proofs valid", () => {
    const leaves = makeLeaves(16);
    const { root, tree } = buildMerkleTree(leaves);
    for (let i = 0; i < 16; i++) {
      expect(verifyProof(root, tree[0]![i]!, generateProof(tree, i))).toBe(true);
    }
  });
});

describe("verifyProof", () => {
  it("returns false for tampered proof", () => {
    const leaves = makeLeaves(4);
    const { root, tree } = buildMerkleTree(leaves);
    const proof = generateProof(tree, 0);
    // Flip last byte of first sibling
    const orig = proof[0]!;
    const lastByte = parseInt(orig.slice(-2), 16);
    const flipped = ((lastByte + 1) % 256).toString(16).padStart(2, "0");
    const tampered = (orig.slice(0, -2) + flipped) as Hex;
    expect(verifyProof(root, tree[0]![0]!, [tampered, ...proof.slice(1)])).toBe(false);
  });
});

describe("determinism", () => {
  it("shuffling input order produces same root", () => {
    const leaves = makeLeaves(8);
    const { root: r1 } = buildMerkleTree(leaves);
    const { root: r2 } = buildMerkleTree(shuffle(leaves));
    expect(r1.toLowerCase()).toBe(r2.toLowerCase());
  });

  it("shuffling 13 leaves produces same root", () => {
    const leaves = makeLeaves(13);
    const { root: r1 } = buildMerkleTree(leaves);
    const { root: r2 } = buildMerkleTree(shuffle(leaves));
    expect(r1.toLowerCase()).toBe(r2.toLowerCase());
  });
});
