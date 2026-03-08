import { Elysia } from "elysia";

export function createHealthServer(port: number) {
  const app = new Elysia()
    .get("/health", () => ({ status: "ok" }))
    .listen(port);

  return app;
}
