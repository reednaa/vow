import bs58 from "bs58";

export const ETHEREUM_MAINNET_CHAIN_ID = "eip155:1";
export const SOLANA_MAINNET_CHAIN_ID = "solana:mainnet";

export const SOLANA_CHAIN_ID_ALIASES = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
} as const;

const EVM_CAIP2_RE = /^eip155:(\d+)$/;
const SOLANA_CAIP2_RE = /^solana:(.+)$/;

function decodeSolanaGenesisHash(chainId: string, genesisHash: string): Uint8Array {
  const decoded = bs58.decode(genesisHash);
  if (decoded.length !== 32) {
    throw new Error(`Invalid Solana genesis hash length for ${chainId}: ${decoded.length} bytes`);
  }
  return decoded;
}

export function normalizeChainId(chainId: string): string {
  if (EVM_CAIP2_RE.test(chainId)) return chainId;

  const solMatch = SOLANA_CAIP2_RE.exec(chainId);
  if (!solMatch || !solMatch[1]) {
    throw new Error(`Invalid CAIP-2 chain ID: ${chainId}`);
  }

  const clusterOrGenesisHash = solMatch[1];
  const aliasedChainId =
    SOLANA_CHAIN_ID_ALIASES[clusterOrGenesisHash as keyof typeof SOLANA_CHAIN_ID_ALIASES];
  if (aliasedChainId) return aliasedChainId;

  decodeSolanaGenesisHash(chainId, clusterOrGenesisHash);
  return `solana:${clusterOrGenesisHash}`;
}

export function caip2ToNumericChainId(chainId: string): bigint {
  const normalizedChainId = normalizeChainId(chainId);
  const evmMatch = EVM_CAIP2_RE.exec(normalizedChainId);
  if (evmMatch && evmMatch[1]) return BigInt(evmMatch[1]);

  const solMatch = SOLANA_CAIP2_RE.exec(normalizedChainId);
  if (solMatch && solMatch[1]) {
    const genesisHash = decodeSolanaGenesisHash(normalizedChainId, solMatch[1]);
    let result = 0n;
    for (let i = 0; i < 32; i++) {
      result = (result << 8n) | BigInt(genesisHash[i]!);
    }
    return result;
  }

  throw new Error(`Cannot extract numeric chain ID from: ${chainId}`);
}
