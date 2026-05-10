import type { Address } from "viem";
import type {
  DecodedEthereumEvent,
  DecodedSolanaEvent,
  ProcessVowResult,
  WitnessResult,
  WitnessSource,
} from "@vow/protocol";

export type {
  DecodedEthereumEvent,
  DecodedSolanaEvent,
  ProcessVowResult,
  SignedWitness,
  WitnessRequest,
  WitnessResult,
  WitnessSource,
} from "@vow/protocol";

export type DemoSourceMode = "ethereum" | "solana";

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
