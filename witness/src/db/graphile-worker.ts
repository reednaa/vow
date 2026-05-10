import { bigint, integer, json, pgSchema, smallint, text, timestamp } from "drizzle-orm/pg-core";

const graphileWorker = pgSchema("graphile_worker");

export const graphileWorkerPrivateTasks = graphileWorker.table("_private_tasks", {
  id: integer("id").primaryKey(),
  identifier: text("identifier").notNull(),
});

export const graphileWorkerPrivateJobs = graphileWorker.table("_private_jobs", {
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  taskId: integer("task_id").notNull(),
  payload: json("payload").$type<unknown>().notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull(),
  attempts: smallint("attempts").notNull(),
  maxAttempts: smallint("max_attempts").notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  key: text("key"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
});
