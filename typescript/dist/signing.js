import { compactSignatureToSignature, hashTypedData, parseCompactSignature, parseSignature, recoverAddress, serializeCompactSignature, signatureToCompactSignature, } from "viem";
import { caip2ToNumericChainId } from "./chain.js";
export const vowDomain = {};
export const vowTypes = {
    Vow: [
        { name: "chainId", type: "uint256" },
        { name: "rootBlockNumber", type: "uint256" },
        { name: "root", type: "bytes32" },
    ],
};
export function getVowTypedData(params) {
    return {
        domain: vowDomain,
        types: vowTypes,
        primaryType: "Vow",
        message: {
            chainId: params.chainId,
            rootBlockNumber: params.rootBlockNumber,
            root: params.root,
        },
    };
}
export function computeVowDigest(params) {
    return hashTypedData(getVowTypedData(params));
}
export async function signVowRoot(params, signTypedData) {
    const signature = await signTypedData(getVowTypedData(params));
    return serializeCompactSignature(signatureToCompactSignature(parseSignature(signature)));
}
export async function recoverVowSigner(options) {
    const recoverableSignature = options.signature.length === 130
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
//# sourceMappingURL=signing.js.map