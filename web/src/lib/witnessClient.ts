import type { WitnessResult } from "./types.js";

export interface PollOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

export async function fetchWitness(
  url: string,
  chainId: number,
  blockNumber: number,
  logIndex: number
): Promise<{ status: string; witness?: WitnessResult; error?: string }> {
  const endpoint = `${url}/witness/eip155:${chainId}/${blockNumber}/${logIndex}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json() as Promise<{ status: string; witness?: WitnessResult; error?: string }>;
}

export async function pollWitness(
  url: string,
  chainId: number,
  blockNumber: number,
  logIndex: number,
  opts: PollOptions = {}
): Promise<WitnessResult> {
  const { pollIntervalMs = 1000, timeoutMs = 60000, signal, onStatus } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    const body = await fetchWitness(url, chainId, blockNumber, logIndex);
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
