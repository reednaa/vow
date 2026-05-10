import type { Hex } from "viem";
import type { EthereumWitnessResult, WitnessRequest, WitnessResult } from "./types.js";

function normalizeHex(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

export interface PollOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

export async function fetchWitness(
  url: string,
  request: WitnessRequest
): Promise<{ status: string; witness?: WitnessResult; error?: string }> {
  const endpoint =
    request.mode === "ethereum"
      ? `${url}/witness/${request.chainId}/${request.blockNumber}/${request.logIndex}`
      : `${url}/witness/solana/${request.chainId}/${request.txSignature}/${request.index}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  const body = (await res.json()) as {
    status: string;
    witness?: Record<string, unknown>;
    error?: string;
  };
  if (body.status !== "ready" || !body.witness) {
    return body as { status: string; error?: string };
  }

  if (request.mode === "ethereum") {
    return {
      status: body.status,
      witness: {
        mode: "ethereum",
        signer: body.witness.signer as WitnessResult["signer"],
        chainId: body.witness.chainId as string,
        rootBlockNumber: body.witness.rootBlockNumber as number,
        proof: body.witness.proof as Hex[],
        signature: body.witness.signature as Hex,
        event: body.witness.event as EthereumWitnessResult["event"],
      },
    };
  }

  const event = body.witness.event as Record<string, string>;
  return {
    status: body.status,
    witness: {
      mode: "solana",
      signer: body.witness.signer as WitnessResult["signer"],
      chainId: body.witness.chainId as string,
      rootBlockNumber: body.witness.rootSlot as number,
      proof: body.witness.proof as Hex[],
      signature: body.witness.signature as Hex,
      event: {
        programId: normalizeHex(event.programId),
        discriminator: normalizeHex(event.discriminator),
        data: normalizeHex(event.data),
      },
    },
  };
}

export async function pollWitness(
  url: string,
  request: WitnessRequest,
  opts: PollOptions = {}
): Promise<WitnessResult> {
  const { pollIntervalMs = 1000, timeoutMs = 60000, signal, onStatus } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    const body = await fetchWitness(url, request);
    onStatus?.(body.status);

    if (body.status === "failed") {
      throw new Error(`Witness failed: ${body.error ?? "unknown error"}`);
    }
    if (body.status === "ready") {
      if (!body.witness) throw new Error("Ready status but no witness payload");
      return body.witness;
    }

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, pollIntervalMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("Aborted"));
      });
    });
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for witness from ${url}`);
}
