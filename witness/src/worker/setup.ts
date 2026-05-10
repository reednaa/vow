import { run } from "graphile-worker";
import type { Signer } from "../core/signer.interface.ts";
import { createIndexBlockTask, INDEX_BLOCK_TASK } from "./index-block.task.ts";
import {
  createIndexSolanaSlotTask,
  INDEX_SOLANA_SLOT_TASK,
} from "./index-solana-slot.task.ts";
import type { ConsistentBlockResult, ConsistentSlotResult } from "../rpc/consistency.ts";
import type { Db } from "../db/client.ts";
import type { RpcClient } from "../rpc/client.ts";
import type { SolanaRpcClient } from "../rpc/solana-client.ts";

export async function setupWorker(options: {
  databaseUrl: string;
  signer: Signer;
  db: Db;
  workerSchema?: string;
  fetchBlock?: (rpcs: RpcClient[], blockNumber: bigint) => Promise<ConsistentBlockResult>;
  fetchSolanaSlot?: (rpcs: SolanaRpcClient[], slot: bigint) => Promise<ConsistentSlotResult>;
}) {
  const { databaseUrl, signer, db, workerSchema, fetchBlock, fetchSolanaSlot } = options;

  const runner = await run({
    connectionString: databaseUrl,
    schema: workerSchema,
    concurrency: 3,
    taskList: {
      [INDEX_BLOCK_TASK]: createIndexBlockTask(db, signer, fetchBlock),
      [INDEX_SOLANA_SLOT_TASK]: createIndexSolanaSlotTask(db, signer, fetchSolanaSlot),
    },
  });

  return runner;
}
