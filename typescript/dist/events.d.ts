import { type Address, type Hex } from "viem";
import type { DecodedEthereumEvent, DecodedSolanaEvent } from "./types.js";
export declare const EVENT_IX_TAG: Uint8Array<ArrayBuffer>;
export declare function encodeEthereumEvent(emitter: Address, topics: Hex[], data: Hex): Uint8Array;
export declare function decodeEthereumEvent(canonicalBytes: Uint8Array): DecodedEthereumEvent;
export declare function encodeSolanaEvent(programId: Uint8Array | Hex, discriminator: Uint8Array | Hex, data: Uint8Array | Hex): Uint8Array;
export declare function decodeSolanaEvent(canonicalBytes: Uint8Array): DecodedSolanaEvent;
export declare function computeLeafHash(canonicalBytes: Uint8Array): Hex;
export declare function isEmitCpi(innerData: string, innerProgram: string, parentProgram: string): boolean;
export declare function extractEmitCpiEncoding(innerData: string, programId: Uint8Array): {
    discriminator: Uint8Array;
    data: Uint8Array;
    canonicalBytes: Uint8Array;
    leafHash: Hex;
};
//# sourceMappingURL=events.d.ts.map