import { mergeWitnesses, encodeVow } from "./vow.js";
function normalizeHex(value) {
    return (value.startsWith("0x") ? value : `0x${value}`);
}
function baseUrl(url) {
    return url.replace(/\/+$/, "");
}
export function buildWitnessUrl(url, request) {
    if (request.mode === "ethereum") {
        return `${baseUrl(url)}/witness/${request.chainId}/${request.blockNumber}/${request.logIndex}`;
    }
    return `${baseUrl(url)}/witness/solana/${request.chainId}/${request.txSignature}/${request.index}`;
}
export async function fetchWitness(url, request, fetchFn = globalThis.fetch) {
    const res = await fetchFn(buildWitnessUrl(url, request));
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`);
    }
    const body = (await res.json());
    if (body.status !== "ready") {
        return { status: body.status, error: body.error };
    }
    if (!body.witness) {
        throw new Error("Ready status but no witness payload");
    }
    if (request.mode === "ethereum") {
        return {
            status: "ready",
            witness: {
                mode: "ethereum",
                signer: body.witness.signer,
                chainId: body.witness.chainId,
                rootBlockNumber: body.witness.rootBlockNumber,
                proof: body.witness.proof,
                signature: body.witness.signature,
                event: body.witness.event,
            },
        };
    }
    const event = body.witness.event;
    return {
        status: "ready",
        witness: {
            mode: "solana",
            signer: body.witness.signer,
            chainId: body.witness.chainId,
            rootBlockNumber: body.witness.rootSlot,
            proof: body.witness.proof,
            signature: body.witness.signature,
            event: {
                programId: normalizeHex(event.programId),
                discriminator: normalizeHex(event.discriminator),
                data: normalizeHex(event.data),
            },
        },
    };
}
export async function pollWitness(url, request, options = {}) {
    const { pollIntervalMs = 1000, timeoutMs = 60000, signal, fetch: fetchFn = globalThis.fetch, onStatus, } = options;
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
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, pollIntervalMs);
            signal?.addEventListener("abort", () => {
                clearTimeout(timeout);
                reject(new Error("Aborted"));
            });
        });
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for witness from ${url}`);
}
export async function fetchWitnesses(sources, request, options = {}) {
    const witnesses = await Promise.all(sources.map(async (source) => {
        const witness = await pollWitness(source.url, request, {
            ...options,
            onStatus: (status) => {
                options.onStatus?.(status);
                options.onWitnessStatus?.(source, status);
            },
        });
        return { witness, signerIndex: source.signerIndex };
    }));
    return mergeWitnesses(witnesses);
}
export async function fetchAndEncodeVow(sources, request, options = {}) {
    return encodeVow(await fetchWitnesses(sources, request, options));
}
//# sourceMappingURL=witness.js.map