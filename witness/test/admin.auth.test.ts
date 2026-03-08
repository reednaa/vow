import { describe, it, expect, beforeAll } from "bun:test";
import { SignJWT } from "jose";
import { Elysia } from "elysia";
import { createAdminApiPlugin } from "../src/api/admin/api";

const JWT_SECRET = "test-secret-for-admin-auth";
const WRONG_SECRET = "wrong-secret-does-not-match";

let app: Elysia;

async function sign(secret: string, payload: object = { sub: "admin" }, expiresIn?: string) {
  const key = new TextEncoder().encode(secret);
  const builder = new SignJWT(payload as Record<string, unknown>).setProtectedHeader({
    alg: "HS256",
  });
  if (expiresIn !== undefined) {
    builder.setExpirationTime(expiresIn);
  }
  return builder.sign(key);
}

function makeRequest(cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) {
    headers["Cookie"] = `adminToken=${cookie}`;
  }
  return new Request("http://localhost/admin/api/me", { headers });
}

beforeAll(() => {
  app = new Elysia().use(createAdminApiPlugin({} as any, JWT_SECRET));
});

describe("Admin API JWT guard", () => {
  it("returns 401 when no cookie is present", async () => {
    const res = await app.handle(makeRequest());
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it("returns 401 when cookie is a random string (not a JWT)", async () => {
    const res = await app.handle(makeRequest("not-a-jwt-at-all"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it("returns 401 when JWT is signed with the wrong secret", async () => {
    const token = await sign(WRONG_SECRET);
    const res = await app.handle(makeRequest(token));
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it("returns 200 with { ok: true } when JWT is signed with the correct secret", async () => {
    const token = await sign(JWT_SECRET);
    const res = await app.handle(makeRequest(token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("returns 401 when JWT is expired", async () => {
    const token = await sign(JWT_SECRET, { sub: "admin" }, "-1s");
    const res = await app.handle(makeRequest(token));
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toBeTruthy();
  });
});
