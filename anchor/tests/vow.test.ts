import { describe, expect, it } from "bun:test";
import {
  concat,
  hashTypedData,
  hexToBytes,
  keccak256,
  parseSignature,
  serializeCompactSignature,
  signatureToCompactSignature,
  stringToHex,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const VOW_DOMAIN = {} as const;
const VOW_TYPES = {
  Vow: [
    { name: "chainId", type: "uint256" },
    { name: "rootBlockNumber", type: "uint256" },
    { name: "root", type: "bytes32" },
  ],
} as const;
const EVENT_IX_TAG = new Uint8Array([
  0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d,
]);

function bytes32(value: number | bigint): Uint8Array {
  return hexToBytes(toHex(BigInt(value), { size: 32 }));
}

function bytes20(value: string): Uint8Array {
  return hexToBytes(value as `0x${string}`);
}

function keccakBytes(data: Uint8Array): Uint8Array {
  return hexToBytes(keccak256(data));
}

function encodeEvent(
  emitter: `0x${string}`,
  topics: `0x${string}`[],
  data: Uint8Array,
): Uint8Array {
  const encoded = new Uint8Array(21 + topics.length * 32 + data.length);
  encoded.set(bytes20(emitter), 0);
  encoded[20] = topics.length;
  topics.forEach((topic, i) => encoded.set(hexToBytes(topic), 21 + i * 32));
  encoded.set(data, 21 + topics.length * 32);
  return encoded;
}

function encodeEmitCpi(
  programId: Uint8Array,
  discriminator: Uint8Array,
  borshData: Uint8Array,
): Uint8Array {
  const encoded = new Uint8Array(40 + borshData.length);
  encoded.set(programId, 0);
  encoded.set(discriminator, 32);
  encoded.set(borshData, 40);
  return encoded;
}

function leafHash(evt: Uint8Array): Uint8Array {
  return keccakBytes(keccakBytes(evt));
}

function computeMerkleRoot(proof: Uint8Array[], leaf: Uint8Array): Uint8Array {
  let root = leaf;
  for (const sibling of proof) {
    root =
      Buffer.compare(Buffer.from(root), Buffer.from(sibling)) <= 0
        ? keccakBytes(concat([root, sibling]))
        : keccakBytes(concat([sibling, root]));
  }
  return root;
}

function computeVowDigest(chainId: bigint, rootBlockNumber: bigint, root: `0x${string}`): `0x${string}` {
  return hashTypedData({
    domain: VOW_DOMAIN,
    types: VOW_TYPES,
    primaryType: "Vow",
    message: { chainId, rootBlockNumber, root },
  });
}

function encodeVow(
  chainId: bigint,
  rootBlockNumber: bigint,
  proof: Uint8Array[],
  signerIndices: number[],
  signatures: Uint8Array[],
  evt: Uint8Array,
): Uint8Array {
  const totalSignatureBytes = signatures.reduce((sum, sig) => sum + 2 + sig.length, 0);
  const encoded = new Uint8Array(
    68 + proof.length * 32 + signerIndices.length + totalSignatureBytes + evt.length,
  );

  encoded.set(bytes32(chainId), 0);
  encoded.set(bytes32(rootBlockNumber), 32);
  encoded[64] = proof.length;
  encoded[65] = signerIndices.length;
  encoded[66] = (evt.length >> 8) & 0xff;
  encoded[67] = evt.length & 0xff;

  let cursor = 68;
  proof.forEach((node) => {
    encoded.set(node, cursor);
    cursor += 32;
  });
  signerIndices.forEach((index) => {
    encoded[cursor] = index;
    cursor += 1;
  });
  signatures.forEach((signature) => {
    encoded[cursor] = (signature.length >> 8) & 0xff;
    encoded[cursor + 1] = signature.length & 0xff;
    cursor += 2;
    encoded.set(signature, cursor);
    cursor += signature.length;
  });
  encoded.set(evt, cursor);
  return encoded;
}

describe("anchor/vow workspace helpers", () => {
  it("matches current witness compact signature output", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const digest = computeVowDigest(1n, 490n, toHex(bytes32(7)));
    const recoverable = await account.signTypedData({
      domain: VOW_DOMAIN,
      types: VOW_TYPES,
      primaryType: "Vow",
      message: { chainId: 1n, rootBlockNumber: 490n, root: toHex(bytes32(7)) },
    });
    const compact = serializeCompactSignature(
      signatureToCompactSignature(parseSignature(recoverable)),
    );

    expect(hexToBytes(recoverable).length).toBe(65);
    expect(hexToBytes(compact).length).toBe(64);
    expect(digest).toBe(
      hashTypedData({
        domain: VOW_DOMAIN,
        types: VOW_TYPES,
        primaryType: "Vow",
        message: { chainId: 1n, rootBlockNumber: 490n, root: toHex(bytes32(7)) },
      }),
    );
  });

  it("encodes vow payloads around compact signatures", async () => {
    const account = privateKeyToAccount(`0x${"22".repeat(32)}`);
    const eventBytes = encodeEvent(
      "0x" + "ab".repeat(20),
      [toHex(bytes32(1)), toHex(bytes32(2))],
      new Uint8Array([0xde, 0xad]),
    );
    const root = toHex(computeMerkleRoot([], leafHash(eventBytes)));
    const signature = await account.signTypedData({
      domain: VOW_DOMAIN,
      types: VOW_TYPES,
      primaryType: "Vow",
      message: { chainId: 10n, rootBlockNumber: 490n, root },
    });
    const compact = hexToBytes(
      serializeCompactSignature(signatureToCompactSignature(parseSignature(signature))),
    );

    const vowBytes = encodeVow(10n, 490n, [], [1], [compact], eventBytes);

    expect(vowBytes[64]).toBe(0);
    expect(vowBytes[65]).toBe(1);
    expect(vowBytes[vowBytes.length - 1]).toBe(0xad);
    expect(vowBytes.slice(vowBytes.length - eventBytes.length)).toEqual(eventBytes);
  });

  it("preserves the Solana canonical emit_cpi layout", () => {
    const discriminator = new Uint8Array([0x73, 0x77, 0x61, 0x70, 0x5f, 0x65, 0x76, 0x74]);
    const payload = new Uint8Array([1, 2, 3, 4]);
    const canonical = encodeEmitCpi(bytes32(9), discriminator, payload);

    expect(canonical.slice(0, 32)).toEqual(bytes32(9));
    expect(canonical.slice(32, 40)).toEqual(discriminator);
    expect(canonical.slice(40)).toEqual(payload);
  });

  it("keeps the Anchor event ix tag stable", () => {
    expect(toHex(EVENT_IX_TAG)).toBe("0xe445a52e51cb9a1d");
  });
});
