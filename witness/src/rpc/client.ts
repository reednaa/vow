import { type Address, type Hex, createPublicClient, http } from "viem";

export type RpcBlock = {
  hash: Hex;
  number: bigint;
};

export type RpcLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  logIndex: number;
};

export type RpcClient = {
  getBlock(blockNumber: bigint): Promise<RpcBlock | null>;
  getLogs(blockNumber: bigint): Promise<RpcLog[]>;
  getBlockNumber(): Promise<bigint>;
};

export function createRpcClient(url: string): RpcClient {
  const client = createPublicClient({ transport: http(url) });

  return {
    async getBlock(blockNumber: bigint) {
      const block = await client.getBlock({ blockNumber });
      if (!block) return null;
      return {
        hash: block.hash as Hex,
        number: block.number,
      };
    },

    async getLogs(blockNumber: bigint) {
      const logs = await client.getLogs({
        fromBlock: blockNumber,
        toBlock: blockNumber,
      });
      return logs
        .map((log) => ({
          address: log.address as Address,
          topics: log.topics as Hex[],
          data: log.data as Hex,
          logIndex: log.logIndex ?? 0,
        }))
        .sort((a, b) => a.logIndex - b.logIndex);
    },

    async getBlockNumber() {
      return client.getBlockNumber();
    },
  };
}
