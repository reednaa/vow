import { initTelemetry, shutdownTelemetry } from "../telemetry/index.ts";
import { loadWorkerConfig } from "../config/env.ts";
import { createEnvSigner } from "../core/signing.ts";
import { createDb, closeDb } from "../db/client.ts";
import { setupWorker } from "../worker/setup.ts";
import { createWorkerHealthServer } from "../api/health.server.ts";

async function main() {
  initTelemetry();
  const config = loadWorkerConfig();
  const db = createDb(config.databaseUrl);
  let ready = false;
  const healthServer = createWorkerHealthServer(config.workerHealthPort, () => ready, db);
  const signer = createEnvSigner(config.witnessPrivateKey);
  const worker = await setupWorker({
    databaseUrl: config.databaseUrl,
    signer,
    db,
  });
  ready = true;

  console.log("Worker signer address:", signer.address());

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    console.log("Worker shutting down...");

    try {
      healthServer.stop();
    } catch {}

    try {
      await worker.stop();
    } catch (error) {
      console.error("Worker stop error:", error);
    }

    await closeDb();
    await shutdownTelemetry();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch(async (error) => {
  console.error("Worker startup error:", error);
  await shutdownTelemetry();
  process.exit(1);
});
