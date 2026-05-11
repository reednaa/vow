import { describe, expect, it } from "bun:test";
import { createWorkerHealthServer } from "../src/api/health.server";
import type { Db } from "../src/db/client";

const workingDb = {
  execute: async () => {},
} as unknown as Db;

const brokenDb = {
  execute: async () => { throw new Error("connection refused"); },
} as unknown as Db;

describe("Worker health server", () => {
  it("returns 200 when worker is ready and DB is reachable", async () => {
    const server = createWorkerHealthServer(0, () => true, workingDb, { listen: false });
    const res = await server.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ready");
  });

  it("returns 503 when DB is unreachable", async () => {
    const server = createWorkerHealthServer(0, () => true, brokenDb, { listen: false });
    const res = await server.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.status).toBe("db_unavailable");
  });

  it("returns 503 when worker is not ready (but DB is reachable)", async () => {
    const server = createWorkerHealthServer(0, () => false, workingDb, { listen: false });
    const res = await server.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.status).toBe("not_ready");
  });

  it("returns 503 when both DB is down and worker is not ready (DB check first)", async () => {
    const server = createWorkerHealthServer(0, () => false, brokenDb, { listen: false });
    const res = await server.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.status).toBe("db_unavailable");
  });
});
