import { keccak256, toBytes } from "viem";
function sortPair(a, b) {
    return BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
}
function hashPair(a, b) {
    const [lo, hi] = sortPair(a, b);
    const combined = new Uint8Array(64);
    combined.set(toBytes(lo), 0);
    combined.set(toBytes(hi), 32);
    return keccak256(combined);
}
export const ZERO_HASH = `0x${"00".repeat(32)}`;
export function buildMerkleTree(leaves) {
    if (leaves.length === 0) {
        return { root: ZERO_HASH, tree: [[ZERO_HASH]] };
    }
    const sorted = [...leaves].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    const tree = [sorted];
    let current = sorted;
    while (current.length > 1) {
        const next = [];
        for (let i = 0; i < current.length; i += 2) {
            if (i + 1 < current.length) {
                next.push(hashPair(current[i], current[i + 1]));
            }
            else {
                next.push(current[i]);
            }
        }
        tree.push(next);
        current = next;
    }
    return { root: current[0], tree };
}
export function generateProof(tree, leafIndex) {
    const proof = [];
    let index = leafIndex;
    for (let level = 0; level < tree.length - 1; level++) {
        const levelNodes = tree[level];
        const siblingIndex = index ^ 1;
        if (siblingIndex < levelNodes.length) {
            proof.push(levelNodes[siblingIndex]);
        }
        index = Math.floor(index / 2);
    }
    return proof;
}
export function verifyProof(root, leaf, proof) {
    let current = leaf;
    for (const sibling of proof) {
        current = hashPair(current, sibling);
    }
    return current.toLowerCase() === root.toLowerCase();
}
export function buildStoredEventProof(events, treeIndex) {
    const sortedEvents = [...events].sort((a, b) => a.treeIndex - b.treeIndex);
    const leafHashes = sortedEvents.map((event) => event.leafHash);
    const { tree } = buildMerkleTree(leafHashes);
    return generateProof(tree, treeIndex);
}
//# sourceMappingURL=merkle.js.map