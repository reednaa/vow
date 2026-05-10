import { describe, expect, it } from "bun:test";
import type { Address, Hex } from "viem";
import {
  buildWitnessUrl,
  decodeVowEvent,
  fetchAndEncodeVow,
  fetchWitness,
  getDirectorySigner,
  pollWitness,
  processVow,
  validateWitnessSigners,
  witnessDirectoryAbi,
  type ReadContractFn,
  type SignedWitness,
  type WitnessRequest,
} from "../src/index.js";

const SIGNER = "0x0000000000000000000000000000000000000001" as Address;
const OTHER_SIGNER = "0x0000000000000000000000000000000000000002" as Address;
const DIRECTORY = "0x0000000000000000000000000000000000000010" as Address;
const VOW_LIB = "0x0000000000000000000000000000000000000020" as Address;
const PROOF_HASH = (`0x${"bb".repeat(32)}`) as Hex;
const SIG = (`0x${"cc".repeat(65)}`) as Hex;

const ethereumRequest: WitnessRequest = {
  mode: "ethereum",
  chainId: "eip155:1",
  blockNumber: 100,
  logIndex: 2,
};

const readyWitness = {
  signer: SIGNER,
  chainId: "eip155:1",
  rootBlockNumber: 100,
  proof: [PROOF_HASH],
  signature: SIG,
  event: {
    emitter: "0x1234567890abcdef1234567890abcdef12345678",
    topics: [`0x${"aa".repeat(32)}`],
    data: "0xdeadbeef",
  },
};

function jsonFetch(body: unknown): typeof fetch {
  return (async () => Response.json(body)) as typeof fetch;
}

describe("witness fetching", () => {
  it("builds EVM and Solana URLs", () => {
    expect(buildWitnessUrl("https://witness.example.com/", ethereumRequest)).toBe(
      "https://witness.example.com/witness/eip155:1/100/2",
    );
    expect(
      buildWitnessUrl("https://witness.example.com", {
        mode: "solana",
        chainId: "solana:mainnet",
        txSignature: "abc",
        index: 3,
      }),
    ).toBe("https://witness.example.com/witness/solana/solana:mainnet/abc/3");
  });

  it("normalizes ready witness responses", async () => {
    const response = await fetchWitness(
      "https://witness.example.com",
      ethereumRequest,
      jsonFetch({ status: "ready", witness: readyWitness }),
    );

    expect(response.status).toBe("ready");
    if (response.status === "ready") {
      expect(response.witness.mode).toBe("ethereum");
      expect(response.witness.event.data).toBe("0xdeadbeef");
    }
  });

  it("polls until ready and encodes witnesses", async () => {
    let calls = 0;
    const statuses: string[] = [];
    const fetchMock = (async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ status: "pending" })
        : Response.json({ status: "ready", witness: readyWitness });
    }) as typeof fetch;

    const witness = await pollWitness("https://witness.example.com", ethereumRequest, {
      fetch: fetchMock,
      pollIntervalMs: 1,
      onStatus: (status) => statuses.push(status),
    });

    expect(witness.signer).toBe(SIGNER);
    expect(statuses).toEqual(["pending", "ready"]);

    const vow = await fetchAndEncodeVow(
      [{ url: "https://witness.example.com", signerIndex: 1 }],
      ethereumRequest,
      { fetch: jsonFetch({ status: "ready", witness: readyWitness }) },
    );
    expect(vow).toMatch(/^0x/);
  });
});

describe("contract helpers", () => {
  it("reads directory signers and validates witness signers", async () => {
    const readContract: ReadContractFn = async (parameters) => {
      expect(parameters.abi).toBe(witnessDirectoryAbi);
      return parameters.args?.[0] === 1n ? SIGNER : OTHER_SIGNER;
    };
    const signed: SignedWitness[] = [
      {
        signerIndex: 1,
        witness: {
          mode: "ethereum",
          signer: SIGNER,
          chainId: "eip155:1",
          rootBlockNumber: 100,
          proof: [],
          signature: SIG,
          event: {
            emitter: "0x1234567890abcdef1234567890abcdef12345678",
            topics: [],
            data: "0x",
          },
        },
      },
    ];

    expect(await getDirectorySigner(readContract, DIRECTORY, 1)).toBe(SIGNER);
    expect(await validateWitnessSigners({ readContract, directoryAddress: DIRECTORY, witnesses: signed })).toEqual([
      {
        signerIndex: 1,
        witnessSigner: SIGNER,
        onChainSigner: SIGNER,
        matches: true,
      },
    ]);
  });

  it("processes and decodes Vow data through injected viem-compatible calls", async () => {
    const readContract: ReadContractFn = async (parameters) => {
      if (parameters.functionName === "processVow") {
        return [1n, 100n, "0x1234"];
      }
      if (parameters.functionName === "decodeEvent") {
        return [SIGNER, [], "0x1234"];
      }
      throw new Error(`unexpected function ${parameters.functionName}`);
    };

    const processed = await processVow({
      readContract,
      estimateContractGas: async () => 50000n,
      vowLibAddress: VOW_LIB,
      directoryAddress: DIRECTORY,
      vowBytes: "0xabcd",
    });

    expect(processed).toEqual({
      processVowResult: { chainId: 1n, rootBlockNumber: 100n, evt: "0x1234" },
      gasEstimate: 50000n,
    });

    expect(
      await decodeVowEvent({
        readContract,
        vowLibAddress: VOW_LIB,
        mode: "ethereum",
        evt: processed.processVowResult.evt,
      }),
    ).toEqual({ emitter: SIGNER, topics: [], data: "0x1234" });
  });
});
