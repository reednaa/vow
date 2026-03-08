import { Elysia } from "elysia";
import { mountWitnessHandler, type AddJobFn } from "./witness.handler.ts";

function applyCorsHeaders(request: Request, set: { headers: Record<string, string> }) {
  const origin = request.headers.get("origin");
  const requestedHeaders = request.headers.get("access-control-request-headers");

  set.headers["access-control-allow-origin"] = origin ?? "*";
  set.headers["access-control-allow-methods"] = "GET,OPTIONS";
  set.headers["access-control-allow-headers"] = requestedHeaders ?? "content-type";
  set.headers["access-control-max-age"] = "86400";
  set.headers.vary = "origin";
}

export function createApiServer(port: number, db: any, addJob: AddJobFn) {
  const app = new Elysia()
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
    });

  mountWitnessHandler(app, db, addJob);

  app.listen(port);
  return app;
}
