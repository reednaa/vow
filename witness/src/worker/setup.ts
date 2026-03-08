import { run } from "graphile-worker";
import type { Signer } from "../core/signer.interface.ts";
import { createIndexBlockTask, INDEX_BLOCK_TASK } from "./index-block.task.ts";
import type { ConsistentBlockResult } from "../rpc/consistency.ts";

export async function setupWorker(options: {
  databaseUrl: string;
  signer: Signer;
  db: any;
  fetchBlock?: (rpcs: any[], blockNumber: bigint) => Promise<ConsistentBlockResult>;
}) {
  const { databaseUrl, signer, db, fetchBlock } = options;

  const runner = await run({
    connectionString: databaseUrl,
    concurrency: 3,
    taskList: {
      [INDEX_BLOCK_TASK]: createIndexBlockTask(db, signer, fetchBlock),
    },
  });

  return runner;
}
