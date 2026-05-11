import { Elysia } from "elysia";
import type { Db } from "../db/client.ts";
import { sql } from "drizzle-orm";

async function checkDb(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export function createHealthServer(port: number, db: Db) {
  const app = new Elysia()
    .get("/health", async ({ set }) => {
      if (!(await checkDb(db))) {
        set.status = 503;
        return { status: "db_unavailable" as const };
      }
      return { status: "ok" as const };
    })
    .listen(port);

  return app;
}

export function createWorkerHealthServer(
  port: number,
  isReady: () => boolean,
  db: Db,
  options?: { listen?: boolean }
) {
  const app = new Elysia()
    .get("/health", async ({ set }) => {
      if (!(await checkDb(db))) {
        set.status = 503;
        return { status: "db_unavailable" as const };
      }
      if (!isReady()) {
        set.status = 503;
        return { status: "not_ready" as const };
      }
      return { status: "ready" as const };
    });

  if (options?.listen !== false) {
    app.listen(port);
  }

  return app;
}
