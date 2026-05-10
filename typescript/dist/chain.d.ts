export declare const ETHEREUM_MAINNET_CHAIN_ID = "eip155:1";
export declare const SOLANA_MAINNET_CHAIN_ID = "solana:mainnet";
export declare const SOLANA_CHAIN_ID_ALIASES: {
    readonly mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    readonly devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    readonly testnet: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
};
export declare function normalizeChainId(chainId: string): string;
export declare function caip2ToNumericChainId(chainId: string): bigint;
//# sourceMappingURL=chain.d.ts.map