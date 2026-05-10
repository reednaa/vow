import type { Address, Hex } from "viem";

export type DemoSourceMode = "ethereum" | "solana";

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

export interface EthereumWitnessResult {
  mode: "ethereum";
  signer: Address;
  chainId: string;
  rootBlockNumber: number;
  proof: Hex[];
  signature: Hex;
  event: { emitter: Address; topics: Hex[]; data: Hex };
}

export interface SolanaWitnessResult {
  mode: "solana";
  signer: Address;
  chainId: string;
  rootBlockNumber: number;
  proof: Hex[];
  signature: Hex;
  event: { programId: Hex; discriminator: Hex; data: Hex };
}

export type WitnessResult = EthereumWitnessResult | SolanaWitnessResult;

export interface SignedWitness {
  witness: WitnessResult;
  signerIndex: number;
}

export type WitnessStatus = "idle" | "polling" | "ready" | "failed";

export interface ProofResult {
  source: WitnessSource;
  status: WitnessStatus;
  witness?: WitnessResult;
  error?: string;
  signerMatch?: {
    selectedIndex: number;
    witnessSigner: Address;
    onChainSigner: Address;
    matches: boolean;
  };
}

export type StepState = "idle" | "running" | "done" | "error";

export interface Step {
  label: string;
  state: StepState;
  detail?: string;
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

export type DecodedVowResult =
  | {
      mode: "ethereum";
      processVowResult: ProcessVowResult;
      decodedEvent: DecodedEthereumEvent;
    }
  | {
      mode: "solana";
      processVowResult: ProcessVowResult;
      decodedEvent: DecodedSolanaEvent;
    };
