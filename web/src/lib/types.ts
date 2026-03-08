import type { Address, Hex } from "viem";

export interface WitnessSource {
  url: string;
  signerIndex: number;
}

export interface WitnessResult {
  signer: Address;
  chainId: number;
  rootBlockNumber: number;
  proof: Hex[];
  signature: Hex;
  event: { emitter: Address; topics: Hex[]; data: Hex };
}

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

export interface VowResult {
  chainId: bigint;
  rootBlockNumber: bigint;
  emitter: Address;
  topics: Hex[];
  data: Hex;
}
