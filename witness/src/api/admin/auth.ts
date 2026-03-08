import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";

// Simple in-memory rate limiter: max 5 attempts per 15 minutes per IP
const attempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX = 5;
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX) return false;
  entry.count++;
  return true;
}

export function createAuthHandler(passwordHash: string, jwtSecret: string) {
  return new Elysia({ prefix: "/admin/auth" })
    .use(jwt({ name: "jwt", secret: jwtSecret, exp: "24h" }))
    .post(
      "/login",
      async ({ jwt, cookie: { adminToken }, body, request, set }) => {
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        if (!checkRateLimit(ip)) {
          set.status = 429;
          return { error: "Too many login attempts. Try again in 15 minutes." };
        }
        const valid = await Bun.password.verify(body.password, passwordHash);
        if (!valid) {
          set.status = 401;
          return { error: "Invalid password" };
        }
        adminToken?.set({
          value: await jwt.sign({ sub: "admin" }),
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV !== "development",
          path: "/",
          maxAge: 86400,
        });
        return { ok: true };
      },
      { body: t.Object({ password: t.String({ minLength: 1 }) }) }
    )
    .post("/logout", ({ cookie: { adminToken } }) => {
      adminToken?.remove();
      return { ok: true };
    });
}
