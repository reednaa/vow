import type { Address, Hex } from "viem";
import { mergeWitnesses, encodeVow } from "./vow.js";
import type {
  EthereumWitnessResult,
  FetchWitnessesOptions,
  PollOptions,
  SignedWitness,
  SolanaWitnessResult,
  WitnessFetchResponse,
  WitnessRequest,
  WitnessResponseStatus,
  WitnessResult,
  WitnessSource,
} from "./types.js";

function normalizeHex(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

function baseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function buildWitnessUrl(url: string, request: WitnessRequest): string {
  if (request.mode === "ethereum") {
    return `${baseUrl(url)}/witness/${request.chainId}/${request.blockNumber}/${request.logIndex}`;
  }

  return `${baseUrl(url)}/witness/solana/${request.chainId}/${request.txSignature}/${request.index}`;
}

export async function fetchWitness(
  url: string,
  request: WitnessRequest,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<WitnessFetchResponse> {
  const res = await fetchFn(buildWitnessUrl(url, request));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  const body = (await res.json()) as {
    status: WitnessResponseStatus;
    witness?: Record<string, unknown>;
    error?: string;
  };

  if (body.status !== "ready" || !body.witness) {
    return { status: body.status, error: body.error };
  }

  if (request.mode === "ethereum") {
    return {
      status: "ready",
      witness: {
        mode: "ethereum",
        signer: body.witness.signer as Address,
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
    status: "ready",
    witness: {
      mode: "solana",
      signer: body.witness.signer as Address,
      chainId: body.witness.chainId as string,
      rootBlockNumber: body.witness.rootSlot as number,
      proof: body.witness.proof as Hex[],
      signature: body.witness.signature as Hex,
      event: {
        programId: normalizeHex(event.programId!),
        discriminator: normalizeHex(event.discriminator!),
        data: normalizeHex(event.data!),
      },
    } satisfies SolanaWitnessResult,
  };
}

export async function pollWitness(
  url: string,
  request: WitnessRequest,
  options: PollOptions = {},
): Promise<WitnessResult> {
  const {
    pollIntervalMs = 1000,
    timeoutMs = 60000,
    signal,
    fetch: fetchFn = globalThis.fetch,
    onStatus,
  } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    const body = await fetchWitness(url, request, fetchFn);
    onStatus?.(body.status);

    if (body.status === "failed" || body.status === "error") {
      throw new Error(`Witness failed: ${body.error ?? "unknown error"}`);
    }
    if (body.status === "ready") {
      return body.witness;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, pollIntervalMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("Aborted"));
      });
    });
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for witness from ${url}`);
}

export async function fetchWitnesses(
  sources: WitnessSource[],
  request: WitnessRequest,
  options: FetchWitnessesOptions = {},
): Promise<SignedWitness[]> {
  const witnesses = await Promise.all(
    sources.map(async (source) => {
      const witness = await pollWitness(source.url, request, {
        ...options,
        onStatus: (status) => {
          options.onStatus?.(status);
          options.onWitnessStatus?.(source, status);
        },
      });
      return { witness, signerIndex: source.signerIndex };
    }),
  );

  return mergeWitnesses(witnesses);
}

export async function fetchAndEncodeVow(
  sources: WitnessSource[],
  request: WitnessRequest,
  options: FetchWitnessesOptions = {},
): Promise<Hex> {
  return encodeVow(await fetchWitnesses(sources, request, options));
}
