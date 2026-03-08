import { loadConfig } from "./config/env.ts";
import { createEnvSigner } from "./core/signing.ts";
import { createDb, closeDb } from "./db/client.ts";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { setupWorker } from "./worker/setup.ts";
import { createHealthServer } from "./api/health.server.ts";
import { createApiServer } from "./api/server.ts";
import path from "path";

async function main() {
  const config = loadConfig();

  const signer = createEnvSigner(config.witnessPrivateKey);
  console.log("Witness signer address:", signer.address());

  const db = createDb(config.databaseUrl);

  const migrationsFolder = path.resolve(import.meta.dir, "../drizzle");
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied");

  const worker = await setupWorker({
    databaseUrl: config.databaseUrl,
    signer,
    db,
  });

  const healthServer = createHealthServer(config.healthPort);
  const apiServer = createApiServer(config.apiPort, db, worker.addJob, signer.address());

  console.log("Vow Witness Service started on port", config.apiPort);

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down...");

    try {
      apiServer.stop();
      healthServer.stop();
    } catch {}

    const timeout = setTimeout(() => {
      console.error("Graceful shutdown timeout exceeded");
      process.exit(1);
    }, 30_000);

    try {
      await worker.stop();
    } catch (e) {
      console.error("Worker stop error:", e);
    }

    clearTimeout(timeout);
    await closeDb();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
