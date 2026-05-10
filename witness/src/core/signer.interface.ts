import type { VowParams } from "@vow/protocol";

export type { VowParams };

export interface Signer {
  signVow(params: VowParams): Promise<Hex>;
  address(): string;
}
