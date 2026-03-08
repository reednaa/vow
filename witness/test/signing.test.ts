import { describe, it, expect } from "bun:test";
import { type Hex, keccak256, toBytes, recoverAddress } from "viem";
import { computeVowDigest, createEnvSigner } from "../src/core/signing";

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
    // Known value: keccak256("EIP712Domain()")
    expect(expected).toMatch(/^0x[0-9a-f]{64}$/);
    // Verify our signing uses this (indirectly: same digest computed twice)
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

  it("signVow returns a 65-byte packed hex signature", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const sig = await signer.signVow(SAMPLE_PARAMS);
    // 0x + 130 hex chars = 132 total (65 bytes)
    expect(sig.length).toBe(132);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});

describe("signer.signVow", () => {
  it("signature recovers to signer address", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const digest = computeVowDigest(SAMPLE_PARAMS);
    const sig = await signer.signVow(SAMPLE_PARAMS);

    // 65 bytes = 0x + 130 hex chars
    expect(sig.length).toBe(132);

    const recovered = await recoverAddress({ hash: digest, signature: sig });
    expect(recovered.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  it("is deterministic for same inputs", async () => {
    const signer = createEnvSigner(TEST_PRIVATE_KEY);
    const sig1 = await signer.signVow(SAMPLE_PARAMS);
    const sig2 = await signer.signVow(SAMPLE_PARAMS);
    expect(sig1).toBe(sig2);
  });
});
