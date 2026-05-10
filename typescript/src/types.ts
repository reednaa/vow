import type { Address, Hex } from "viem";

export type WitnessMode = "ethereum" | "solana";

export type WitnessResponseStatus = "pending" | "indexing" | "ready" | "failed" | "error";

export interface WitnessSource {
  url: string;
  signerIndex: number;
}

export interface EthereumWitnessRequest {
  mode: "ethereum";
  chainId: string;
  blockNumber: number;
  logIndex: number;
}

export interface SolanaWitnessRequest {
  mode: "solana";
  chainId: string;
  txSignature: string;
  index: number;
}

export type WitnessRequest = EthereumWitnessRequest | SolanaWitnessRequest;

export interface EthereumWitnessEvent {
  emitter: Address;
  topics: Hex[];
  data: Hex;
}

export interface SolanaWitnessEvent {
  programId: Hex;
  discriminator: Hex;
  data: Hex;
}

export interface EthereumWitnessResult {
  mode: "ethereum";
  signer: Address;
  chainId: string;
  rootBlockNumber: number;
  proof: Hex[];
  signature: Hex;
  event: EthereumWitnessEvent;
}

export interface SolanaWitnessResult {
  mode: "solana";
  signer: Address;
  chainId: string;
  rootBlockNumber: number;
  proof: Hex[];
  signature: Hex;
  event: SolanaWitnessEvent;
}

export type WitnessResult = EthereumWitnessResult | SolanaWitnessResult;

export interface SignedWitness {
  witness: WitnessResult;
  signerIndex: number;
}

export type WitnessFetchResponse =
  | { status: "ready"; witness: WitnessResult }
  | { status: Exclude<WitnessResponseStatus, "ready">; error?: string };

export interface PollOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  onStatus?: (status: WitnessResponseStatus) => void;
}

export interface FetchWitnessesOptions extends PollOptions {
  onWitnessStatus?: (source: WitnessSource, status: WitnessResponseStatus) => void;
}

export interface VowParams {
  chainId: bigint;
  rootBlockNumber: bigint;
  root: Hex;
}

export interface ProcessVowResult {
  chainId: bigint;
  rootBlockNumber: bigint;
  evt: Hex;
}

export interface DecodedEthereumEvent {
  emitter: Address;
  topics: Hex[];
  data: Hex;
}

export interface DecodedSolanaEvent {
  programId: Hex;
  discriminator: Hex;
  data: Hex;
}

export type DecodedVowEvent = DecodedEthereumEvent | DecodedSolanaEvent;

export interface SignerValidation {
  signerIndex: number;
  witnessSigner: Address;
  onChainSigner: Address;
  matches: boolean;
}

export type ReadContractFn = (parameters: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}) => Promise<unknown>;

export type EstimateContractGasFn = (parameters: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}) => Promise<bigint>;
