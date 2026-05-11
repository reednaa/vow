import type { Address, Hex } from "viem";
import type { DecodedEthereumEvent, DecodedSolanaEvent, EstimateContractGasFn, ProcessVowResult, ReadContractFn, SignedWitness, SignerValidation, WitnessMode } from "./types.js";
export declare const witnessDirectoryAbi: readonly [{
    readonly name: "getSigner";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "index";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "signer";
        readonly type: "address";
    }];
}];
export declare const mockVowLibAbi: readonly [{
    readonly name: "InvalidlySignedRoot";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "TooManyTopics";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "NoQourum";
    readonly type: "error";
    readonly inputs: readonly [{
        readonly name: "requiredQourum";
        readonly type: "uint256";
    }, {
        readonly name: "signers";
        readonly type: "uint256";
    }];
}, {
    readonly name: "SignerIndexRepeat";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "ZeroSigner";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "processVow";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "directory";
        readonly type: "address";
    }, {
        readonly name: "vow";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [{
        readonly name: "chainId";
        readonly type: "uint256";
    }, {
        readonly name: "rootBlockNumber";
        readonly type: "uint256";
    }, {
        readonly name: "evt";
        readonly type: "bytes";
    }];
}, {
    readonly name: "decodeEvent";
    readonly type: "function";
    readonly stateMutability: "pure";
    readonly inputs: readonly [{
        readonly name: "evt";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [{
        readonly name: "emitter";
        readonly type: "address";
    }, {
        readonly name: "topics";
        readonly type: "bytes32[]";
    }, {
        readonly name: "data";
        readonly type: "bytes";
    }];
}, {
    readonly name: "decodeEmitCPI";
    readonly type: "function";
    readonly stateMutability: "pure";
    readonly inputs: readonly [{
        readonly name: "evt";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [{
        readonly name: "programId";
        readonly type: "bytes32";
    }, {
        readonly name: "discriminator";
        readonly type: "bytes8";
    }, {
        readonly name: "data";
        readonly type: "bytes";
    }];
}];
export declare function getDirectorySigner(readContract: ReadContractFn, directoryAddress: Address, signerIndex: number): Promise<Address>;
export declare function validateWitnessSigners(options: {
    readContract: ReadContractFn;
    directoryAddress: Address;
    witnesses: SignedWitness[];
}): Promise<SignerValidation[]>;
export declare function processVow(options: {
    readContract: ReadContractFn;
    estimateContractGas?: EstimateContractGasFn;
    vowLibAddress: Address;
    directoryAddress: Address;
    vowBytes: Hex;
}): Promise<{
    processVowResult: ProcessVowResult;
    gasEstimate?: bigint;
}>;
export declare function decodeVowEvent(options: {
    readContract: ReadContractFn;
    vowLibAddress: Address;
    mode: WitnessMode;
    evt: Hex;
}): Promise<DecodedEthereumEvent | DecodedSolanaEvent>;
//# sourceMappingURL=contracts.d.ts.map