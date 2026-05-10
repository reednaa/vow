import {
  type Address,
  compactSignatureToSignature,
  type Hex,
  parseCompactSignature,
  recoverAddress,
} from "viem";
import { buildMerkleTree, generateProof } from "../core/merkle.ts";
import { caip2ToNumericChainId } from "../core/chain-utils.ts";
import { computeVowDigest } from "../core/signing.ts";

export type StoredLeaf = {
  leafHash: string;
  treeIndex: number;
};

export function buildStoredEventProof(
  events: readonly StoredLeaf[],
  treeIndex: number,
): Hex[] {
  const sortedEvents = [...events].sort((a, b) => a.treeIndex - b.treeIndex);
  const leafHashes = sortedEvents.map((event) => event.leafHash as Hex);
  const { tree } = buildMerkleTree(leafHashes);

  return generateProof(tree, treeIndex);
}

export async function recoverVowSigner(options: {
  chainId: string;
  rootBlockNumber: bigint;
  root: Hex;
  signature: Hex;
}): Promise<Address> {
  const recoverableSignature =
    options.signature.length === 130
      ? compactSignatureToSignature(parseCompactSignature(options.signature))
      : options.signature;

  return recoverAddress({
    hash: computeVowDigest({
      chainId: caip2ToNumericChainId(options.chainId),
      rootBlockNumber: options.rootBlockNumber,
      root: options.root,
    }),
    signature: recoverableSignature,
  });
}
