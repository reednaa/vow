import { eq } from "drizzle-orm";
import type { TaskSpec } from "graphile-worker";
import { graphileWorkerPrivateJobs } from "../db/graphile-worker.ts";
import type { Db } from "../db/client.ts";

export type AddJobFn = (
  identifier: string,
  payload: unknown,
  spec?: TaskSpec,
) => Promise<unknown>;

export type IndexingStatus =
  | { status: "pending" }
  | { status: "indexing" }
  | { status: "failed"; error: string };

type GraphileJobStatus = {
  lockedAt: Date | null;
  attempts: number;
  maxAttempts: number;
};

function toIndexingStatus(
  job: GraphileJobStatus,
  failureMessage: string,
): IndexingStatus {
  if (job.lockedAt) return { status: "indexing" };
  if (job.attempts >= job.maxAttempts) {
    return { status: "failed", error: failureMessage };
  }
  return { status: "pending" };
}

export async function findIndexingStatus(
  db: Db,
  jobKey: string,
  failureMessage: string,
): Promise<IndexingStatus | null> {
  try {
    const [job] = await db
      .select({
        lockedAt: graphileWorkerPrivateJobs.lockedAt,
        attempts: graphileWorkerPrivateJobs.attempts,
        maxAttempts: graphileWorkerPrivateJobs.maxAttempts,
      })
      .from(graphileWorkerPrivateJobs)
      .where(eq(graphileWorkerPrivateJobs.key, jobKey))
      .limit(1);

    return job ? toIndexingStatus(job, failureMessage) : null;
  } catch {
    return null;
  }
}

export type EnqueueResult = {
  result: IndexingStatus;
  created: boolean;
};

export async function enqueueIndexingJob(options: {
  db: Db;
  addJob: AddJobFn;
  identifier: string;
  payload: Record<string, unknown>;
  jobKey: string;
  maxAttempts: number;
  failureMessage: string;
  priority?: number;
}): Promise<EnqueueResult> {
  const existingStatus = await findIndexingStatus(
    options.db,
    options.jobKey,
    options.failureMessage,
  );
  if (existingStatus) return { result: existingStatus, created: false };

  await options.addJob(
    options.identifier,
    options.payload,
    {
      jobKey: options.jobKey,
      maxAttempts: options.maxAttempts,
      priority: options.priority ?? 0,
    },
  );
  return { result: { status: "pending" }, created: true };
}
