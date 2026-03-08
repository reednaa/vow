import { beforeAll, describe, expect, it } from "bun:test";
import { createWorkerHealthServer } from "../src/api/health.server";

let ready = false;
let server: ReturnType<typeof createWorkerHealthServer>;

beforeAll(() => {
  server = createWorkerHealthServer(0, () => ready, { listen: false });
});

describe("GET /health (worker readiness)", () => {
  it("returns 503 when worker is not ready", async () => {
    ready = false;
    const res = await server.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.status).toBe("not_ready");
  });

  it("returns 200 when worker is ready", async () => {
    ready = true;
    const res = await server.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ready");
  });
});
