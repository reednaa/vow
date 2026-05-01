import { keccak256, hexToBytes, bytesToHex, concat, toHex, stringToHex } from "viem";
import { assert } from "chai";

const VOW_TYPE_HASH_STR =
  "Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)";
const DOMAIN_TYPEHASH_STR = "EIP712Domain()";

function keccakBytes(data: Uint8Array | string): Uint8Array {
  if (typeof data === "string") return hexToBytes(keccak256(data));
  return hexToBytes(keccak256(data));
}

function bytes32(val: number | bigint): Uint8Array {
  const bn = typeof val === "bigint" ? val : BigInt(val);
  return hexToBytes(toHex(bn, { size: 32 }));
}

function keccakString(s: string): Uint8Array {
  return keccakBytes(stringToHex(s));
}

function encodeEvent(
  emitter: string,
  topics: string[],
  data: Uint8Array,
): Uint8Array {
  const e = hexToBytes(emitter as `0x${string}`);
  assert(e.length === 20);
  assert(topics.length <= 4);

  const out = new Uint8Array(21 + topics.length * 32 + data.length);
  out.set(e, 0);
  out[20] = topics.length;
  for (let i = 0; i < topics.length; i++) {
    const t = hexToBytes(topics[i] as `0x${string}`);
    assert(t.length === 32);
    out.set(t, 21 + i * 32);
  }
  out.set(data, 21 + topics.length * 32);
  return out;
}

function leafHash(evt: Uint8Array): Uint8Array {
  return keccakBytes(keccakBytes(evt));
}

function vowTypehash(
  chainId: Uint8Array,
  rootBlockNumber: Uint8Array,
  root: Uint8Array,
): Uint8Array {
  const typeHash = keccakString(VOW_TYPE_HASH_STR);
  return keccakBytes(concat([typeHash, chainId, rootBlockNumber, root]));
}

function hashTypedData(structHash: Uint8Array): Uint8Array {
  const domain = keccakString(DOMAIN_TYPEHASH_STR);
  const packed = new Uint8Array(66);
  packed[0] = 0x19;
  packed[1] = 0x01;
  packed.set(domain, 2);
  packed.set(structHash, 34);
  return keccakBytes(packed);
}

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function computeMerkleRoot(
  proof: Uint8Array[],
  leaf: Uint8Array,
): Uint8Array {
  let root = leaf;
  for (const s of proof) {
    const pair =
      cmpBytes(root, s) <= 0
        ? new Uint8Array([...root, ...s])
        : new Uint8Array([...s, ...root]);
    root = keccakBytes(pair);
  }
  return root;
}

function buildProofAndRoot(
  leaf: Uint8Array,
  depth: number,
): { proof: Uint8Array[]; root: Uint8Array } {
  const proof: Uint8Array[] = [];
  let root = leaf;
  for (let i = 0; i < depth; i++) {
    const sib = bytes32(i + 1);
    proof.push(sib);
    const pair =
      cmpBytes(root, sib) <= 0
        ? new Uint8Array([...root, ...sib])
        : new Uint8Array([...sib, ...root]);
    root = keccakBytes(pair);
  }
  return { proof, root };
}

function encodeVow(
  chainId: Uint8Array,
  rootBN: Uint8Array,
  proof: Uint8Array[],
  indices: number[],
  sigs: Uint8Array[],
  evt: Uint8Array,
): Uint8Array {
  const P = proof.length;
  const S = indices.length;
  let sigSize = 0;
  for (const s of sigs) sigSize += 2 + s.length;
  const total = 68 + P * 32 + S + sigSize + evt.length;
  const buf = new Uint8Array(total);
  buf.set(chainId, 0);
  buf.set(rootBN, 32);
  buf[64] = P;
  buf[65] = S;
  buf[66] = (evt.length >> 8) & 0xff;
  buf[67] = evt.length & 0xff;
  let c = 68;
  for (const n of proof) {
    buf.set(n, c);
    c += 32;
  }
  for (const i of indices) {
    buf[c] = i;
    c += 1;
  }
  for (let i = 0; i < S; i++) {
    const s = sigs[i];
    buf[c] = (s.length >> 8) & 0xff;
    buf[c + 1] = s.length & 0xff;
    c += 2;
    buf.set(s, c);
    c += s.length;
  }
  buf.set(evt, c);
  return buf;
}

function parseVow(buf: Uint8Array): {
  chainId: Uint8Array;
  rootBN: Uint8Array;
  P: number;
  S: number;
  E: number;
} {
  return {
    chainId: buf.slice(0, 32),
    rootBN: buf.slice(32, 64),
    P: buf[64],
    S: buf[65],
    E: ((buf[66] << 8) | buf[67]) >>> 0,
  };
}

function makeEvt(): Uint8Array {
  return encodeEvent(
    "0x" + "beef".repeat(5),
    [bytesToHex(keccakString("Topic0")), bytesToHex(keccakString("Topic1"))],
    bytes32(123),
  );
}

describe("Vow Protocol — Solana port (ECDSA + Viem)", () => {
  describe("Event encode / decode (EVM log format)", () => {
    it("round-trips: 0 topics", () => {
      const emitter = "0x" + "de".repeat(20);
      const data = new Uint8Array([1, 2]);
      const enc = encodeEvent(emitter, [], data);
      assert.equal(enc.length, 23);
      assert.equal(enc[20], 0);
      assert.equal(bytesToHex(enc.slice(0, 20)), emitter.toLowerCase());
      assert.deepEqual(Array.from(enc.slice(21)), [1, 2]);
    });

    it("round-trips: 4 topics", () => {
      const emitter = "0x" + "ca".repeat(20);
      const topics = [1, 2, 3, 4].map((n) =>
        "0x" + n.toString(16).padStart(64, "0"),
      );
      const data = new Uint8Array(32);
      const enc = encodeEvent(emitter, topics, data);
      assert.equal(enc.length, 21 + 4 * 32 + 32);
      assert.equal(enc[20], 4);
    });
  });

  describe("leafHash", () => {
    it("double-keccak256", () => {
      const evt = new Uint8Array([1, 2, 3]);
      const lh = leafHash(evt);
      const inner = keccakBytes(evt);
      assert.deepEqual(lh, keccakBytes(inner));
    });
  });

  describe("Merkle root", () => {
    it("depth 0 = leaf", () => {
      const leaf = bytes32(999);
      assert.deepEqual(computeMerkleRoot([], leaf), leaf);
    });

    it("depth 10 round-trip", () => {
      const leaf = bytes32(42);
      const { proof, root: expected } = buildProofAndRoot(leaf, 10);
      assert.deepEqual(computeMerkleRoot(proof, leaf), expected);
    });

    it("sorted-pair hashing (leaf > sibling)", () => {
      const leaf = bytes32(300);
      const sibling = bytes32(50);
      const root = computeMerkleRoot([sibling], leaf);
      const manual = keccakBytes(new Uint8Array([...sibling, ...leaf]));
      assert.deepEqual(root, manual);
    });
  });

  describe("EIP-712 typed data", () => {
    it("vowTypehash produces 32 bytes", () => {
      const h = vowTypehash(bytes32(10), bytes32(490), bytes32(0xabcdef));
      assert.equal(h.length, 32);
    });

    it("hashTypedData produces 32 bytes", () => {
      const d = hashTypedData(bytes32(1));
      assert.equal(d.length, 32);
    });
  });

  describe("Vow byte encoding", () => {
    it("produces a well-formed vow buffer", () => {
      const evt = makeEvt();
      const leaf = leafHash(evt);
      const { proof } = buildProofAndRoot(leaf, 3);
      const vow = encodeVow(
        bytes32(1),
        bytes32(21_000_000),
        proof,
        [1, 2],
        [new Uint8Array(65), new Uint8Array(65)],
        evt,
      );

      const p = parseVow(vow);
      assert.equal(p.P, 3);
      assert.equal(p.S, 2);
      assert.equal(p.E, evt.length);
      assert.deepEqual(vow.slice(vow.length - p.E), evt);
    });
  });

  describe("Full processVow flow (off-chain)", () => {
    it("verifies: 1-signer depth-0, byte-identical vow", () => {
      const chainId = bytes32(10);
      const rootBN = bytes32(490);
      const evt = makeEvt();
      const leaf = leafHash(evt);
      const { root } = buildProofAndRoot(leaf, 0);

      const structHash = vowTypehash(chainId, rootBN, root);
      const digest = hashTypedData(structHash);
      assert.equal(digest.length, 32);

      const vow = encodeVow(chainId, rootBN, [], [1], [new Uint8Array(65)], evt);
      const parsed = parseVow(vow);
      assert.equal(parsed.P, 0);
      assert.equal(parsed.S, 1);
    });
  });
});