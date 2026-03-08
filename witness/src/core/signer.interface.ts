import type { Hex } from "viem";

export type VowParams = {
  chainId: bigint;
  rootBlockNumber: bigint;
  root: Hex;
};

export interface Signer {
  signVow(params: VowParams): Promise<Hex>;
  address(): string;
}
