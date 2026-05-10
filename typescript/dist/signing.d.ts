import { type Hex } from "viem";
import type { VowParams } from "./types.js";
export declare const vowDomain: {};
export declare const vowTypes: {
    readonly Vow: readonly [{
        readonly name: "chainId";
        readonly type: "uint256";
    }, {
        readonly name: "rootBlockNumber";
        readonly type: "uint256";
    }, {
        readonly name: "root";
        readonly type: "bytes32";
    }];
};
export declare function getVowTypedData(params: VowParams): {
    readonly domain: {};
    readonly types: {
        readonly Vow: readonly [{
            readonly name: "chainId";
            readonly type: "uint256";
        }, {
            readonly name: "rootBlockNumber";
            readonly type: "uint256";
        }, {
            readonly name: "root";
            readonly type: "bytes32";
        }];
    };
    readonly primaryType: "Vow";
    readonly message: {
        readonly chainId: bigint;
        readonly rootBlockNumber: bigint;
        readonly root: `0x${string}`;
    };
};
export declare function computeVowDigest(params: VowParams): Hex;
export type SignTypedDataFn = (typedData: ReturnType<typeof getVowTypedData>) => Promise<Hex>;
export declare function signVowRoot(params: VowParams, signTypedData: SignTypedDataFn): Promise<Hex>;
export declare function recoverVowSigner(options: {
    chainId: string;
    rootBlockNumber: bigint;
    root: Hex;
    signature: Hex;
}): Promise<`0x${string}`>;
//# sourceMappingURL=signing.d.ts.map