import { initTelemetry, shutdownTelemetry } from "../telemetry/index.ts";
import { makeWorkerUtils } from "graphile-worker";
import { loadApiConfig } from "../config/env.ts";
import { createDb, closeDb } from "../db/client.ts";
import { createApiServer } from "../api/server.ts";
import { createHealthServer } from "../api/health.server.ts";

async function main() {
  initTelemetry();
  const config = loadApiConfig();
  const db = createDb(config.databaseUrl);
  const workerUtils = await makeWorkerUtils({ connectionString: config.databaseUrl });
  const apiServer = createApiServer(
    config.apiPort,
    db,
    workerUtils.addJob,
    config.witnessSignerAddress,
    config.adminPasswordHash,
    config.adminJwtSecret
  );
  const healthServer = createHealthServer(config.healthPort, db);

  console.log("Witness API started on port", config.apiPort);

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("API shutting down...");

    try {
      apiServer.stop();
      healthServer.stop();
    } catch {}

    try {
      await workerUtils.release();
    } catch (error) {
      console.error("Worker utils release error:", error);
    }

    await closeDb();
    await shutdownTelemetry();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch(async (error) => {
  console.error("API startup error:", error);
  await shutdownTelemetry();
  process.exit(1);
});
