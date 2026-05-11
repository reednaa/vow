import type { Hex } from "viem";
import type { FetchWitnessesOptions, PollOptions, SignedWitness, FetchFn, WitnessFetchResponse, WitnessRequest, WitnessResult, WitnessSource } from "./types.js";
export declare function buildWitnessUrl(url: string, request: WitnessRequest): string;
export declare function fetchWitness(url: string, request: WitnessRequest, fetchFn?: FetchFn): Promise<WitnessFetchResponse>;
export declare function pollWitness(url: string, request: WitnessRequest, options?: PollOptions): Promise<WitnessResult>;
export declare function fetchWitnesses(sources: WitnessSource[], request: WitnessRequest, options?: FetchWitnessesOptions): Promise<SignedWitness[]>;
export declare function fetchAndEncodeVow(sources: WitnessSource[], request: WitnessRequest, options?: FetchWitnessesOptions): Promise<Hex>;
//# sourceMappingURL=witness.d.ts.map