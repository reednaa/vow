import { signVowRoot, type VowParams } from "@vow/protocol";
import { privateKeyToAccount } from "viem/accounts";
import type { Signer } from "./signer.interface.ts";

export function createEnvSigner(privateKeyHex: string): Signer {
  const withPrefix = privateKeyHex.startsWith("0x")
    ? (privateKeyHex as `0x${string}`)
    : (`0x${privateKeyHex}` as `0x${string}`);

  const account = privateKeyToAccount(withPrefix);

  return {
    async signVow(params: VowParams) {
      return signVowRoot(params, (typedData) => account.signTypedData(typedData));
    },
    address() {
      return account.address;
    },
  };
}
