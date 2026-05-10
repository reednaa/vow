export const witnessDirectoryAbi = [
    {
        name: "getSigner",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "index", type: "uint256" }],
        outputs: [{ name: "signer", type: "address" }],
    },
];
export const mockVowLibAbi = [
    { name: "InvalidlySignedRoot", type: "error", inputs: [] },
    { name: "TooManyTopics", type: "error", inputs: [] },
    {
        name: "NoQourum",
        type: "error",
        inputs: [
            { name: "requiredQourum", type: "uint256" },
            { name: "signers", type: "uint256" },
        ],
    },
    { name: "SignerIndexRepeat", type: "error", inputs: [] },
    { name: "ZeroSigner", type: "error", inputs: [] },
    {
        name: "processVow",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "directory", type: "address" },
            { name: "vow", type: "bytes" },
        ],
        outputs: [
            { name: "chainId", type: "uint256" },
            { name: "rootBlockNumber", type: "uint256" },
            { name: "evt", type: "bytes" },
        ],
    },
    {
        name: "decodeEvent",
        type: "function",
        stateMutability: "pure",
        inputs: [{ name: "evt", type: "bytes" }],
        outputs: [
            { name: "emitter", type: "address" },
            { name: "topics", type: "bytes32[]" },
            { name: "data", type: "bytes" },
        ],
    },
    {
        name: "decodeEmitCPI",
        type: "function",
        stateMutability: "pure",
        inputs: [{ name: "evt", type: "bytes" }],
        outputs: [
            { name: "programId", type: "bytes32" },
            { name: "discriminator", type: "bytes8" },
            { name: "data", type: "bytes" },
        ],
    },
];
export async function getDirectorySigner(readContract, directoryAddress, signerIndex) {
    return (await readContract({
        address: directoryAddress,
        abi: witnessDirectoryAbi,
        functionName: "getSigner",
        args: [BigInt(signerIndex)],
    }));
}
export async function validateWitnessSigners(options) {
    return Promise.all(options.witnesses.map(async (signedWitness) => {
        const onChainSigner = await getDirectorySigner(options.readContract, options.directoryAddress, signedWitness.signerIndex);
        const witnessSigner = signedWitness.witness.signer;
        return {
            signerIndex: signedWitness.signerIndex,
            witnessSigner,
            onChainSigner,
            matches: onChainSigner.toLowerCase() === witnessSigner.toLowerCase(),
        };
    }));
}
export async function processVow(options) {
    const args = [options.directoryAddress, options.vowBytes];
    const [result, gasEstimate] = await Promise.all([
        options.readContract({
            address: options.vowLibAddress,
            abi: mockVowLibAbi,
            functionName: "processVow",
            args,
        }),
        options.estimateContractGas?.({
            address: options.vowLibAddress,
            abi: mockVowLibAbi,
            functionName: "processVow",
            args,
        }),
    ]);
    const [chainId, rootBlockNumber, evt] = result;
    return {
        processVowResult: { chainId, rootBlockNumber, evt },
        gasEstimate,
    };
}
export async function decodeVowEvent(options) {
    if (options.mode === "ethereum") {
        const [emitter, topics, data] = (await options.readContract({
            address: options.vowLibAddress,
            abi: mockVowLibAbi,
            functionName: "decodeEvent",
            args: [options.evt],
        }));
        return { emitter, topics, data };
    }
    const [programId, discriminator, data] = (await options.readContract({
        address: options.vowLibAddress,
        abi: mockVowLibAbi,
        functionName: "decodeEmitCPI",
        args: [options.evt],
    }));
    return { programId, discriminator, data };
}
//# sourceMappingURL=contracts.js.map