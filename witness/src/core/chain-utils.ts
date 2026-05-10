import base58 from "bs58";

/**
 * Extracts a numeric chain ID (bigint) from a CAIP-2 string for use in
 * EIP-712 signing and witness binary encoding.
 *
 * EVM: "eip155:1" → 1n
 * Solana: "solana:<genesis-hash>" → BigInt from 32-byte decoded genesis hash (big-endian)
 */
export function caip2ToNumericChainId(chainId: string): bigint {
  const evmMatch = /^eip155:(\d+)$/.exec(chainId);
  if (evmMatch && evmMatch[1]) return BigInt(evmMatch[1]);

  const solMatch = /^solana:(.+)$/.exec(chainId);
  if (solMatch && solMatch[1]) {
    const genesisHash = base58.decode(solMatch[1]);
    if (genesisHash.length !== 32) {
      throw new Error(`Invalid Solana genesis hash length: ${genesisHash.length} bytes`);
    }
    let result = 0n;
    for (let i = 0; i < 32; i++) {
      result = (result << 8n) | BigInt(genesisHash[i]!);
    }
    return result;
  }

  throw new Error(`Cannot extract numeric chain ID from: ${chainId}`);
}
