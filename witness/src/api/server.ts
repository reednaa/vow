import { Elysia } from "elysia";
import swagger from "@elysiajs/swagger";
import { mountWitnessHandler } from "./witness.handler.ts";
import { mountSolanaWitnessHandler } from "./solana-witness.handler.ts";
import { createAdminHandler } from "./admin/index.ts";
import { mountChainsHandler } from "./chains.handler.ts";
import { createApiKeyDerive } from "./api-key.middleware.ts";
import type { Db } from "../db/client.ts";
import type { AddJobFn } from "./jobs.ts";

function applyCorsHeaders(request: Request, set: { headers: Record<string, string> }) {
  const origin = request.headers.get("origin");
  const requestedHeaders = request.headers.get("access-control-request-headers");

  set.headers["access-control-allow-origin"] = origin ?? "*";
  set.headers["access-control-allow-methods"] = "GET,OPTIONS";
  set.headers["access-control-allow-headers"] = requestedHeaders ?? "content-type";
  set.headers["access-control-max-age"] = "86400";
  set.headers.vary = "origin";
}

export function createApiServer(
  port: number,
  db: Db,
  addJob: AddJobFn,
  witnessSigner: string,
  adminPasswordHash: string | null = null,
  adminJwtSecret: string | null = null
) {
  const app = new Elysia()
    .use(
      swagger({
        path: "/docs",
        exclude: /^\/admin/,
        documentation: {
          info: {
            title: "Vow Witness API",
            version: "1.0.0",
            description:
              "EVM and Solana event attestation service. " +
              "Indexes block logs and CPI events, builds Merkle trees over canonical event encodings, " +
              "signs the root, and serves event-level witness payloads with verifiable Merkle proofs.",
          },
          tags: [
            {
              name: "Witness",
              description: "Retrieve signed witness payloads with Merkle proofs for indexed EVM events",
            },
            {
              name: "Solana Witness",
              description: "Retrieve signed witness payloads with Merkle proofs for indexed Solana CPI events",
            },
            {
              name: "Chains",
              description: "List and inspect supported chains",
            },
          ],
        },
      })
    )
    .onRequest(({ request, set }) => {
      applyCorsHeaders(request, set as { headers: Record<string, string> });
      if (request.method === "OPTIONS") {
        set.status = 204;
        return "";
      }
    })
    .onError(({ error, code, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: error.message };
      }
      set.status = 500;
      return { error: String(error) };
    })
    .derive(createApiKeyDerive(db));

  mountWitnessHandler(app, db, addJob, witnessSigner);
  mountSolanaWitnessHandler(app, db, addJob, witnessSigner);
  mountChainsHandler(app, db);
  app.use(createAdminHandler(db, adminPasswordHash, adminJwtSecret));

  app.listen(port);
  return app;
}
