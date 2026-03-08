import { Elysia } from "elysia";

export function createHealthServer(port: number) {
  const app = new Elysia()
    .get("/health", () => ({ status: "ok" }))
    .listen(port);

  return app;
}

export function createWorkerHealthServer(
  port: number,
  isReady: () => boolean,
  options?: { listen?: boolean }
) {
  const app = new Elysia()
    .get("/health", ({ set }) => {
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
