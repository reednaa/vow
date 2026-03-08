import { describe, it, expect } from "bun:test";
import { type Address, type Hex, toBytes, toHex } from "viem";
import {
  encodeVow,
  type WitnessResult,
  type SignedWitness,
} from "../src/client/index.ts";
import { encodeEvent } from "../src/core/encoding.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

const EMITTER = "0x1234567890abcdef1234567890abcdef12345678" as Address;
const TOPIC = ("0x" + "aa".repeat(32)) as Hex;
const DATA = "0xdeadbeef" as Hex;
const PROOF_HASH = ("0x" + "bb".repeat(32)) as Hex;
const SIG = ("0x" + "cc".repeat(65)) as Hex;
const SIG2 = ("0x" + "dd".repeat(65)) as Hex;

function makeWitness(overrides?: Partial<WitnessResult>): WitnessResult {
  return {
    chainId: 31337,
    rootBlockNumber: 90,
    proof: [PROOF_HASH],
    signature: SIG,
    event: { emitter: EMITTER, topics: [TOPIC], data: DATA },
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("encodeVow", () => {
  it("encodes a single-signer vow correctly", () => {
    const result = encodeVow([
      { witness: makeWitness(), signerIndex: 1 },
    ]);

    expect(result).toMatch(/^0x/);
    const bytes = toBytes(result);

    // Read header
    const view = new DataView(bytes.buffer);
    // chainId at offset 0 (last 4 bytes of 32)
    expect(bytes[31]).toBe(31337 & 0xff);

    // P=1, S=1
    expect(bytes[64]).toBe(1); // P
    expect(bytes[65]).toBe(1); // S

    // E = event length
    const E = view.getUint16(66, false);
    const eventBytes = encodeEvent(EMITTER, [TOPIC], DATA);
    expect(E).toBe(eventBytes.length);

    // Proof at offset 68
    expect(toHex(bytes.slice(68, 100))).toBe(PROOF_HASH);

    // Signer index at 100
    expect(bytes[100]).toBe(1);

    // Signature length at 101-102
    const sigLen = view.getUint16(101, false);
    expect(sigLen).toBe(65);

    // Signature at 103..168
    expect(toHex(bytes.slice(103, 168))).toBe(SIG);

    // Event at 168..end
    expect(toHex(bytes.slice(168))).toBe(toHex(eventBytes));

    // Total length
    expect(bytes.length).toBe(68 + 32 + 1 + 2 + 65 + eventBytes.length);
  });

  it("encodes multi-signer vow with sorted indices", () => {
    const w1 = makeWitness({ signature: SIG });
    const w2 = makeWitness({ signature: SIG2 });

    // Pass in reverse order — should sort by signerIndex
    const result = encodeVow([
      { witness: w2, signerIndex: 3 },
      { witness: w1, signerIndex: 1 },
    ]);

    const bytes = toBytes(result);

    // S = 2
    expect(bytes[65]).toBe(2);

    const proofEnd = 68 + 32; // 1 proof node
    // Signer indices: should be [1, 3] after sort
    expect(bytes[proofEnd]).toBe(1);
    expect(bytes[proofEnd + 1]).toBe(3);
  });

  it("throws if witnesses have different chainId", () => {
    expect(() =>
      encodeVow([
        { witness: makeWitness({ chainId: 1 }), signerIndex: 1 },
        { witness: makeWitness({ chainId: 2 }), signerIndex: 2 },
      ])
    ).toThrow("same chainId");
  });

  it("throws if witnesses have different rootBlockNumber", () => {
    expect(() =>
      encodeVow([
        { witness: makeWitness({ rootBlockNumber: 10 }), signerIndex: 1 },
        { witness: makeWitness({ rootBlockNumber: 20 }), signerIndex: 2 },
      ])
    ).toThrow("same rootBlockNumber");
  });

  it("throws if witnesses have different events", () => {
    const differentEmitter = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
    expect(() =>
      encodeVow([
        { witness: makeWitness(), signerIndex: 1 },
        {
          witness: makeWitness({
            event: { emitter: differentEmitter, topics: [TOPIC], data: DATA },
          }),
          signerIndex: 2,
        },
      ])
    ).toThrow("same event");
  });

  it("throws if signerIndex values are duplicated", () => {
    expect(() =>
      encodeVow([
        { witness: makeWitness(), signerIndex: 1 },
        { witness: makeWitness({ signature: SIG2 }), signerIndex: 1 },
      ])
    ).toThrow("unique");
  });

  it("throws if no witnesses provided", () => {
    expect(() => encodeVow([])).toThrow("at least one");
  });

  it("handles zero-length proof", () => {
    const result = encodeVow([
      { witness: makeWitness({ proof: [] }), signerIndex: 5 },
    ]);
    const bytes = toBytes(result);
    expect(bytes[64]).toBe(0); // P=0
    // Signer index right after header
    expect(bytes[68]).toBe(5);
  });

  it("handles event with no topics and empty data", () => {
    const w = makeWitness({
      event: { emitter: EMITTER, topics: [], data: "0x" },
    });
    const result = encodeVow([{ witness: w, signerIndex: 1 }]);
    const bytes = toBytes(result);
    const view = new DataView(bytes.buffer);
    const E = view.getUint16(66, false);
    // emitter(20) + topicCount(1) + no topics + no data = 21
    expect(E).toBe(21);
  });
});
