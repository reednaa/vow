import { describe, it, expect } from "bun:test";
import { type Address, type Hex, toBytes, toHex, keccak256 } from "viem";
import { encodeEvent, computeLeafHash, decodeEvent } from "../src/core/encoding";

const ZERO_EMITTER = "0x0000000000000000000000000000000000000000" as Address;
const SAMPLE_EMITTER = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF" as Address;

function makeTopics(n: number): Hex[] {
  return Array.from({ length: n }, (_, i) => {
    const b = new Uint8Array(32);
    b[31] = i + 1;
    return toHex(b) as Hex;
  });
}

describe("encodeEvent", () => {
  it("encodes with 0 topics", () => {
    const encoded = encodeEvent(SAMPLE_EMITTER, [], "0x");
    expect(encoded.length).toBe(21); // 20 + 1
  });

  it("encodes with 1 topic", () => {
    const encoded = encodeEvent(SAMPLE_EMITTER, makeTopics(1), "0x");
    expect(encoded.length).toBe(20 + 1 + 32);
  });

  it("encodes with 2 topics", () => {
    const encoded = encodeEvent(SAMPLE_EMITTER, makeTopics(2), "0x");
    expect(encoded.length).toBe(20 + 1 + 64);
  });

  it("encodes with 3 topics", () => {
    const encoded = encodeEvent(SAMPLE_EMITTER, makeTopics(3), "0x");
    expect(encoded.length).toBe(20 + 1 + 96);
  });

  it("encodes with 4 topics", () => {
    const encoded = encodeEvent(SAMPLE_EMITTER, makeTopics(4), "0x");
    expect(encoded.length).toBe(20 + 1 + 128);
  });

  it("encodes with empty data", () => {
    const encoded = encodeEvent(SAMPLE_EMITTER, makeTopics(2), "0x");
    expect(encoded.length).toBe(20 + 1 + 64 + 0);
  });

  it("encodes with large data (256 bytes)", () => {
    const largeData = toHex(new Uint8Array(256).fill(0xab)) as Hex;
    const encoded = encodeEvent(SAMPLE_EMITTER, makeTopics(1), largeData);
    expect(encoded.length).toBe(20 + 1 + 32 + 256);
  });

  it("emitter is stored as 20 bytes (not padded)", () => {
    const encoded = encodeEvent(SAMPLE_EMITTER, [], "0x");
    const emitterHex = toHex(encoded.slice(0, 20));
    expect(emitterHex.toLowerCase()).toBe(SAMPLE_EMITTER.toLowerCase());
  });

  it("topic_count is encoded as uint8 (1 byte)", () => {
    const encoded = encodeEvent(SAMPLE_EMITTER, makeTopics(3), "0x");
    expect(encoded[20]).toBe(3);
  });
});

describe("decodeEvent roundtrip", () => {
  it("roundtrip with 3 topics", () => {
    const topics = makeTopics(3);
    const dataBytes = new Uint8Array(64).fill(0xca);
    const data = toHex(dataBytes) as Hex;
    const encoded = encodeEvent(SAMPLE_EMITTER, topics, data);
    const decoded = decodeEvent(encoded);
    expect(decoded.emitter.toLowerCase()).toBe(SAMPLE_EMITTER.toLowerCase());
    expect(decoded.topics.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(decoded.topics[i]!.toLowerCase()).toBe(topics[i]!.toLowerCase());
    }
    expect(decoded.data.toLowerCase()).toBe(data.toLowerCase());
  });

  it("roundtrip with 0 topics and empty data", () => {
    const encoded = encodeEvent(ZERO_EMITTER, [], "0x");
    const decoded = decodeEvent(encoded);
    expect(decoded.emitter.toLowerCase()).toBe(ZERO_EMITTER.toLowerCase());
    expect(decoded.topics).toEqual([]);
    expect(decoded.data).toBe("0x");
  });
});

describe("computeLeafHash", () => {
  it("produces double-keccak256", () => {
    const input = new Uint8Array([1, 2, 3, 4]);
    const expected = keccak256(keccak256(input));
    expect(computeLeafHash(input)).toBe(expected);
  });

  it("differs from single keccak256", () => {
    const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(computeLeafHash(input)).not.toBe(keccak256(input));
  });
});

describe("USDC Transfer test vector", () => {
  const emitter = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
  const topic0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
  const topic1 = "0x000000000000000000000000f39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Hex;
  const topic2 = "0x00000000000000000000000070997970C51812dc3A010C7d01b50e0d17dc79C8" as Hex;
  const data = "0x00000000000000000000000000000000000000000000000000000000000f4240" as Hex;
  const topics = [topic0, topic1, topic2];

  it("canonical bytes length is 149", () => {
    expect(encodeEvent(emitter, topics, data).length).toBe(149);
  });

  it("emitter stored correctly", () => {
    const encoded = encodeEvent(emitter, topics, data);
    expect(toHex(encoded.slice(0, 20)).toLowerCase()).toBe(emitter.toLowerCase());
  });

  it("topic_count encodes as 3 (uint8)", () => {
    const encoded = encodeEvent(emitter, topics, data);
    expect(encoded[20]).toBe(3);
  });

  it("leaf hash matches double-keccak256", () => {
    const encoded = encodeEvent(emitter, topics, data);
    const expected = keccak256(keccak256(encoded));
    expect(computeLeafHash(encoded)).toBe(expected);
  });

  it("roundtrip decodes USDC Transfer", () => {
    const encoded = encodeEvent(emitter, topics, data);
    const decoded = decodeEvent(encoded);
    expect(decoded.emitter.toLowerCase()).toBe(emitter.toLowerCase());
    expect(decoded.topics[0]!.toLowerCase()).toBe(topic0.toLowerCase());
    expect(decoded.topics[1]!.toLowerCase()).toBe(topic1.toLowerCase());
    expect(decoded.topics[2]!.toLowerCase()).toBe(topic2.toLowerCase());
    expect(decoded.data.toLowerCase()).toBe(data.toLowerCase());
  });
});
