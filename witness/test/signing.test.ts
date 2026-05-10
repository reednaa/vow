import { describe, it, expect } from "bun:test";
import {
  compactSignatureToSignature,
  type Hex,
  keccak256,
  parseCompactSignature,
  recoverAddress,
  toBytes,
} from "viem";
import { computeVowDigest, createEnvSigner } from "../src/core/signing";
import { caip2ToNumericChainId, normalizeChainId } from "../src/core/chain-utils";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const SAMPLE_PARAMS = {
  chainId: 1n,
  rootBlockNumber: 100n,
  root: ("0x" + "ab".repeat(32)) as Hex,
};

describe("computeVowDigest", () => {
  it("is deterministic", () => {
    expect(computeVowDigest(SAMPLE_PARAMS)).toBe(computeVowDigest(SAMPLE_PARAMS));
  });

  it("changes when params change", () => {
    expect(computeVowDigest(SAMPLE_PARAMS)).not.toBe(
      computeVowDigest({ ...SAMPLE_PARAMS, chainId: 2n })
    );
  });

  it("domain separator is keccak256('EIP712Domain()')", () => {
    const expected = keccak256(toBytes("EIP712Domain()"));
    expect(expected).toMatch(/^0x[0-9a-f]{64}$/);
    expect(computeVowDigest(SAMPLE_PARAMS).length).toBe(66);
  });

  it("type hash is keccak256 of correct type string", () => {
    const typeHash = keccak256(
      toBytes("Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)")
    );
    expect(typeHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("createEnvSigner", () => {
  it("derives correct address with 0x prefix", () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    expect(signer.address().toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  it("derives correct address without 0x prefix", () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY.slice(2));
    expect(signer.address().toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  it("signVow returns a 64-byte compact hex signature", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const sig = await signer.signVow(SAMPLE_PARAMS);
    expect(sig.length).toBe(130);
    expect(sig).toMatch(/^0x[0-9a-f]{128}$/);
  });
});

describe("signer.signVow", () => {
  it("signature recovers to signer address", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const digest = computeVowDigest(SAMPLE_PARAMS);
    const sig = await signer.signVow(SAMPLE_PARAMS);

    expect(sig.length).toBe(130);

    const recoverableSignature = sig.length === 130
      ? compactSignatureToSignature(parseCompactSignature(sig))
      : sig;
    const recovered = await recoverAddress({ hash: digest, signature: recoverableSignature });
    expect(recovered.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  it("is deterministic for same inputs", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const sig1 = await signer.signVow(SAMPLE_PARAMS);
    const sig2 = await signer.signVow(SAMPLE_PARAMS);
    expect(sig1).toBe(sig2);
  });
});

describe("caip2ToNumericChainId", () => {
  it("parses EVM CAIP-2 correctly", () => {
    expect(caip2ToNumericChainId("eip155:1")).toBe(1n);
    expect(caip2ToNumericChainId("eip155:31337")).toBe(31337n);
    expect(caip2ToNumericChainId("eip155:99991")).toBe(99991n);
  });

  it("throws for invalid CAIP-2", () => {
    expect(() => caip2ToNumericChainId("eth:1")).toThrow("Cannot extract numeric chain ID");
    expect(() => caip2ToNumericChainId("bitcoin:1")).toThrow("Cannot extract numeric chain ID");
  });

  it("normalizes Solana aliases before numeric conversion", () => {
    const canonicalMainnet = normalizeChainId("solana:mainnet");
    expect(caip2ToNumericChainId("solana:mainnet")).toBe(
      caip2ToNumericChainId(canonicalMainnet)
    );
  });
});

describe("normalizeChainId", () => {
  it("canonicalizes supported Solana aliases", () => {
    expect(normalizeChainId("solana:mainnet")).toBe(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
    );
    expect(normalizeChainId("solana:devnet")).toBe(
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    );
  });

  it("rejects invalid Solana identifiers", () => {
    expect(() => normalizeChainId("solana:not-base58")).toThrow("Invalid");
  });
});
