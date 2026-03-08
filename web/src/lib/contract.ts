import { type Address, type Hex, createPublicClient, http } from "viem";
import type { VowResult } from "./types.js";

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
      { name: "emitter", type: "address" },
      { name: "topics", type: "bytes32[]" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

export async function callProcessVow(
  rpcUrl: string,
  mockVowLibAddress: Address,
  directoryAddress: Address,
  vowBytes: Hex
): Promise<VowResult> {
  const client = createPublicClient({ transport: http(rpcUrl) });

  const result = await client.readContract({
    address: mockVowLibAddress,
    abi: MOCK_VOW_LIB_ABI,
    functionName: "processVow",
    args: [directoryAddress, vowBytes],
  });

  const [chainId, rootBlockNumber, emitter, topics, data] = result;

  return {
    chainId,
    rootBlockNumber,
    emitter: emitter as Address,
    topics: topics as Hex[],
    data: data as Hex,
  };
}
