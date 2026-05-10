import type { Address, Hex } from "viem";
import type {
  DecodedEthereumEvent,
  DecodedSolanaEvent,
  EstimateContractGasFn,
  ProcessVowResult,
  ReadContractFn,
  SignedWitness,
  SignerValidation,
  WitnessMode,
} from "./types.js";

export const witnessDirectoryAbi = [
  {
    name: "getSigner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "signer", type: "address" }],
  },
] as const;

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
] as const;

export async function getDirectorySigner(
  readContract: ReadContractFn,
  directoryAddress: Address,
  signerIndex: number,
): Promise<Address> {
  return (await readContract({
    address: directoryAddress,
    abi: witnessDirectoryAbi,
    functionName: "getSigner",
    args: [BigInt(signerIndex)],
  })) as Address;
}

export async function validateWitnessSigners(options: {
  readContract: ReadContractFn;
  directoryAddress: Address;
  witnesses: SignedWitness[];
}): Promise<SignerValidation[]> {
  return Promise.all(
    options.witnesses.map(async (signedWitness) => {
      const onChainSigner = await getDirectorySigner(
        options.readContract,
        options.directoryAddress,
        signedWitness.signerIndex,
      );
      const witnessSigner = signedWitness.witness.signer;

      return {
        signerIndex: signedWitness.signerIndex,
        witnessSigner,
        onChainSigner,
        matches: onChainSigner.toLowerCase() === witnessSigner.toLowerCase(),
      };
    }),
  );
}

export async function processVow(options: {
  readContract: ReadContractFn;
  estimateContractGas?: EstimateContractGasFn;
  vowLibAddress: Address;
  directoryAddress: Address;
  vowBytes: Hex;
}): Promise<{ processVowResult: ProcessVowResult; gasEstimate?: bigint }> {
  const args = [options.directoryAddress, options.vowBytes] as const;
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

  const [chainId, rootBlockNumber, evt] = result as readonly [bigint, bigint, Hex];

  return {
    processVowResult: { chainId, rootBlockNumber, evt },
    gasEstimate,
  };
}

export async function decodeVowEvent(options: {
  readContract: ReadContractFn;
  vowLibAddress: Address;
  mode: WitnessMode;
  evt: Hex;
}): Promise<DecodedEthereumEvent | DecodedSolanaEvent> {
  if (options.mode === "ethereum") {
    const [emitter, topics, data] = (await options.readContract({
      address: options.vowLibAddress,
      abi: mockVowLibAbi,
      functionName: "decodeEvent",
      args: [options.evt],
    })) as readonly [Address, Hex[], Hex];

    return { emitter, topics, data };
  }

  const [programId, discriminator, data] = (await options.readContract({
    address: options.vowLibAddress,
    abi: mockVowLibAbi,
    functionName: "decodeEmitCPI",
    args: [options.evt],
  })) as readonly [Hex, Hex, Hex];

  return { programId, discriminator, data };
}
