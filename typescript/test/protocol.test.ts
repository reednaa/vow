import { describe, expect, it } from "bun:test";
import {
  compactSignatureToSignature,
  type Address,
  type Hex,
  keccak256,
  parseCompactSignature,
  recoverAddress,
  toBytes,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  caip2ToNumericChainId,
  computeLeafHash,
  computeVowDigest,
  decodeEthereumEvent,
  decodeSolanaEvent,
  encodeEthereumEvent,
  encodeSolanaEvent,
  encodeVow,
  ETHEREUM_MAINNET_CHAIN_ID,
  generateProof,
  getVowTypedData,
  buildMerkleTree,
  mergeWitnesses,
  normalizeChainId,
  signVowRoot,
  verifyProof,
  ZERO_HASH,
  type EthereumWitnessResult,
  type SignedWitness,
  type SolanaWitnessResult,
  type WitnessResult,
} from "../src/index.js";

const EMITTER = "0x1234567890abcdef1234567890abcdef12345678" as Address;
const TOPIC = (`0x${"aa".repeat(32)}`) as Hex;
const DATA = "0xdeadbeef" as Hex;
const PROOF_HASH = (`0x${"bb".repeat(32)}`) as Hex;
const SIG = (`0x${"cc".repeat(65)}`) as Hex;
const SIG2 = (`0x${"dd".repeat(65)}`) as Hex;
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function makeEthereumWitness(overrides?: Partial<EthereumWitnessResult>): EthereumWitnessResult {
  return {
    mode: "ethereum",
    signer: TEST_ADDRESS as Address,
    chainId: "eip155:31337",
    rootBlockNumber: 90,
    proof: [PROOF_HASH],
    signature: SIG,
    event: { emitter: EMITTER, topics: [TOPIC], data: DATA },
    ...overrides,
  };
}

function makeSolanaWitness(overrides?: Partial<SolanaWitnessResult>): SolanaWitnessResult {
  return {
    mode: "solana",
    signer: TEST_ADDRESS as Address,
    chainId: "solana:mainnet",
    rootBlockNumber: 123,
    proof: [PROOF_HASH],
    signature: SIG,
    event: {
      programId: (`0x${"11".repeat(32)}`) as Hex,
      discriminator: (`0x${"22".repeat(8)}`) as Hex,
      data: "0x3344",
    },
    ...overrides,
  };
}

function makeLeaf(n: number): Hex {
  const bytes = new Uint8Array(32);
  bytes[31] = n;
  return toHex(bytes) as Hex;
}

describe("chain ids", () => {
  it("normalizes Solana aliases and extracts numeric ids", () => {
    expect(ETHEREUM_MAINNET_CHAIN_ID).toBe("eip155:1");
    expect(caip2ToNumericChainId("eip155:31337")).toBe(31337n);
    expect(normalizeChainId("solana:mainnet")).toBe(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    );
    expect(caip2ToNumericChainId("solana:mainnet")).toBe(
      caip2ToNumericChainId(normalizeChainId("solana:mainnet")),
    );
  });
});

describe("event encoding", () => {
  it("roundtrips Ethereum canonical events and hashes with double keccak", () => {
    const encoded = encodeEthereumEvent(EMITTER, [TOPIC], DATA);
    const decoded = decodeEthereumEvent(encoded);

    expect(decoded.emitter.toLowerCase()).toBe(EMITTER.toLowerCase());
    expect(decoded.topics).toEqual([TOPIC]);
    expect(decoded.data).toBe(DATA);
    expect(computeLeafHash(encoded)).toBe(keccak256(keccak256(encoded)));
  });

  it("roundtrips Solana canonical events from hex or bytes", () => {
    const programId = (`0x${"12".repeat(32)}`) as Hex;
    const discriminator = (`0x${"34".repeat(8)}`) as Hex;
    const data = "0x5678" as Hex;
    const encoded = encodeSolanaEvent(programId, discriminator, data);
    const decoded = decodeSolanaEvent(encoded);

    expect(decoded).toEqual({ programId, discriminator, data });
    expect(encodeSolanaEvent(toBytes(programId), toBytes(discriminator), toBytes(data))).toEqual(
      encoded,
    );
  });
});

describe("merkle proofs", () => {
  it("builds deterministic sorted trees and verifies generated proofs", () => {
    const leaves = [makeLeaf(3), makeLeaf(1), makeLeaf(2)];
    const { root, tree } = buildMerkleTree(leaves);

    for (const [index, leaf] of tree[0]!.entries()) {
      expect(verifyProof(root, leaf, generateProof(tree, index))).toBe(true);
    }

    expect(buildMerkleTree([])).toEqual({ root: ZERO_HASH, tree: [[ZERO_HASH]] });
  });
});

describe("signing", () => {
  it("builds typed data, signs compactly, and recovers the signer", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const params = {
      chainId: 1n,
      rootBlockNumber: 100n,
      root: (`0x${"ab".repeat(32)}`) as Hex,
    };

    expect(getVowTypedData(params).primaryType).toBe("Vow");

    const digest = computeVowDigest(params);
    const signature = await signVowRoot(params, (typedData) => account.signTypedData(typedData));
    expect(signature).toMatch(/^0x[0-9a-f]{128}$/);

    const recovered = await recoverAddress({
      hash: digest,
      signature: compactSignatureToSignature(parseCompactSignature(signature)),
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});

describe("Vow encoding", () => {
  it("sorts signers and encodes byte layout", () => {
    const signed: SignedWitness[] = [
      { witness: makeEthereumWitness({ signature: SIG2 }), signerIndex: 3 },
      { witness: makeEthereumWitness({ signature: SIG }), signerIndex: 1 },
    ];
    const merged = mergeWitnesses(signed);
    const vow = encodeVow(signed);
    const bytes = toBytes(vow);
    const view = new DataView(bytes.buffer);
    const eventBytes = encodeEthereumEvent(EMITTER, [TOPIC], DATA);

    expect(merged.map((witness) => witness.signerIndex)).toEqual([1, 3]);
    expect(bytes[64]).toBe(1);
    expect(bytes[65]).toBe(2);
    expect(view.getUint16(66, false)).toBe(eventBytes.length);
    expect(toHex(bytes.slice(68, 100))).toBe(PROOF_HASH);
    expect(bytes[100]).toBe(1);
    expect(bytes[101]).toBe(3);
  });

  it("supports Solana witness events", () => {
    const vow = encodeVow([{ witness: makeSolanaWitness(), signerIndex: 1 }]);
    const bytes = toBytes(vow);
    const view = new DataView(bytes.buffer);

    expect(bytes[64]).toBe(1);
    expect(bytes[65]).toBe(1);
    expect(view.getUint16(66, false)).toBe(42);
  });

  it("rejects mismatched witness groups", () => {
    const witnesses: SignedWitness[] = [
      { witness: makeEthereumWitness(), signerIndex: 1 },
      { witness: makeEthereumWitness({ chainId: "eip155:1" }), signerIndex: 2 },
    ];

    expect(() => mergeWitnesses(witnesses)).toThrow("same chainId");
    expect(() =>
      mergeWitnesses([
        { witness: makeEthereumWitness(), signerIndex: 1 },
        { witness: makeSolanaWitness() as WitnessResult, signerIndex: 2 },
      ]),
    ).toThrow("same event");
  });
});
