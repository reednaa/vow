import { run } from "graphile-worker";
import type { Signer } from "../core/signer.interface.ts";
import { createIndexBlockTask, INDEX_BLOCK_TASK } from "./index-block.task.ts";
import {
  createIndexSolanaSlotTask,
  INDEX_SOLANA_SLOT_TASK,
} from "./index-solana-slot.task.ts";
import type { ConsistentBlockResult, ConsistentSlotResult } from "../rpc/consistency.ts";

export async function setupWorker(options: {
  databaseUrl: string;
  signer: Signer;
  db: any;
  fetchBlock?: (rpcs: any[], blockNumber: bigint) => Promise<ConsistentBlockResult>;
  fetchSolanaSlot?: (rpcs: any[], slot: bigint) => Promise<ConsistentSlotResult>;
}) {
  const { databaseUrl, signer, db, fetchBlock, fetchSolanaSlot } = options;

  const runner = await run({
    connectionString: databaseUrl,
    concurrency: 3,
    taskList: {
      [INDEX_BLOCK_TASK]: createIndexBlockTask(db, signer, fetchBlock),
      [INDEX_SOLANA_SLOT_TASK]: createIndexSolanaSlotTask(db, signer, fetchSolanaSlot),
    },
  });

  return runner;
}
