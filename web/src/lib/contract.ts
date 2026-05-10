import { type Address, type Hex, createPublicClient, http } from "viem";
import type {
  DecodedEthereumEvent,
  DecodedSolanaEvent,
  DemoSourceMode,
  ProcessVowResult,
} from "./types.js";

const WITNESS_DIRECTORY_ABI = [
  {
    name: "getSigner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "signer", type: "address" }],
  },
] as const;

const MOCK_VOW_LIB_ABI = [
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
  rpcUrl: string,
  directoryAddress: Address,
  signerIndex: number
): Promise<Address> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const signer = await client.readContract({
    address: directoryAddress,
    abi: WITNESS_DIRECTORY_ABI,
    functionName: "getSigner",
    args: [BigInt(signerIndex)],
  });

  return signer as Address;
}

export async function callProcessVow(
  rpcUrl: string,
  mockVowLibAddress: Address,
  directoryAddress: Address,
  vowBytes: Hex
): Promise<{ processVowResult: ProcessVowResult; gasEstimate: bigint }> {
  const client = createPublicClient({ transport: http(rpcUrl) });

  const args = [directoryAddress, vowBytes] as const;
  const [result, gasEstimate] = await Promise.all([
    client.readContract({
      address: mockVowLibAddress,
      abi: MOCK_VOW_LIB_ABI,
      functionName: "processVow",
      args,
    }),
    client.estimateContractGas({
      address: mockVowLibAddress,
      abi: MOCK_VOW_LIB_ABI,
      functionName: "processVow",
      args,
    }),
  ]);

  const [chainId, rootBlockNumber, evt] = result;

  return {
    processVowResult: {
      chainId,
      rootBlockNumber,
      evt: evt as Hex,
    },
    gasEstimate,
  };
}

export async function decodeVowEvent(
  rpcUrl: string,
  mockVowLibAddress: Address,
  mode: DemoSourceMode,
  evt: Hex
): Promise<DecodedEthereumEvent | DecodedSolanaEvent> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  if (mode === "ethereum") {
    const [emitter, topics, data] = await client.readContract({
      address: mockVowLibAddress,
      abi: MOCK_VOW_LIB_ABI,
      functionName: "decodeEvent",
      args: [evt],
    });
    return {
      emitter: emitter as Address,
      topics: topics as Hex[],
      data: data as Hex,
    };
  }

  const [programId, discriminator, data] = await client.readContract({
    address: mockVowLibAddress,
    abi: MOCK_VOW_LIB_ABI,
    functionName: "decodeEmitCPI",
    args: [evt],
  });
  return {
    programId: programId as Hex,
    discriminator: discriminator as Hex,
    data: data as Hex,
  };
}
