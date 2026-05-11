import {
  compactSignatureToSignature,
  type Hex,
  hashTypedData,
  parseCompactSignature,
  parseSignature,
  recoverAddress,
  serializeCompactSignature,
  signatureToCompactSignature,
} from "viem";
import { caip2ToNumericChainId } from "./chain.js";
import type { VowParams } from "./types.js";

export const vowDomain = {} as const;

export const vowTypes = {
  Vow: [
    { name: "chainId", type: "uint256" },
    { name: "rootBlockNumber", type: "uint256" },
    { name: "root", type: "bytes32" },
  ],
} as const;

export function getVowTypedData(params: VowParams) {
  return {
    domain: vowDomain,
    types: vowTypes,
    primaryType: "Vow",
    message: {
      chainId: params.chainId,
      rootBlockNumber: params.rootBlockNumber,
      root: params.root,
    },
  } as const;
}

export function computeVowDigest(params: VowParams): Hex {
  return hashTypedData(getVowTypedData(params));
}

export type SignTypedDataFn = (
  typedData: ReturnType<typeof getVowTypedData>,
) => Promise<Hex>;

export async function signVowRoot(
  params: VowParams,
  signTypedData: SignTypedDataFn,
): Promise<Hex> {
  const signature = await signTypedData(getVowTypedData(params));
  return serializeCompactSignature(signatureToCompactSignature(parseSignature(signature)));
}

export async function recoverVowSigner(options: {
  chainId: string;
  rootBlockNumber: bigint;
  root: Hex;
  signature: Hex;
}) {
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
