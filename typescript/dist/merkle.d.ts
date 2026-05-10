import { type Hex } from "viem";
export declare const ZERO_HASH: Hex;
export declare function buildMerkleTree(leaves: Hex[]): {
    root: Hex;
    tree: Hex[][];
};
export declare function generateProof(tree: Hex[][], leafIndex: number): Hex[];
export declare function verifyProof(root: Hex, leaf: Hex, proof: Hex[]): boolean;
export type StoredLeaf = {
    leafHash: string;
    treeIndex: number;
};
export declare function buildStoredEventProof(events: readonly StoredLeaf[], treeIndex: number): Hex[];
//# sourceMappingURL=merkle.d.ts.map