import { Elysia } from "elysia";
import staticPlugin from "@elysiajs/static";
import { existsSync } from "fs";
import { createAuthHandler } from "./auth.ts";
import { createAdminApiPlugin } from "./api.ts";
import type { Db } from "../../db/client.ts";

export function createAdminHandler(
  db: Db,
  adminPasswordHash: string | null,
  adminJwtSecret: string | null
) {
  if (!adminPasswordHash || !adminJwtSecret) {
    return new Elysia()
      .all("/admin/auth/*", ({ set }) => {
        set.status = 503;
        return {
          error:
            "Admin not configured. Set ADMIN_PASSWORD_HASH and ADMIN_JWT_SECRET environment variables.",
        };
      })
      .all("/admin/api/*", ({ set }) => {
        set.status = 503;
        return {
          error:
            "Admin not configured. Set ADMIN_PASSWORD_HASH and ADMIN_JWT_SECRET environment variables.",
        };
      });
  }

  const app = new Elysia()
    .use(createAuthHandler(adminPasswordHash, adminJwtSecret))
    .use(createAdminApiPlugin(db, adminJwtSecret));

  if (existsSync("public/admin")) {
    app.use(staticPlugin({ assets: "public/admin", prefix: "/admin" }));
  } else {
    console.warn("[admin] public/admin not found — run `bun run build:admin` to enable the UI");
  }

  return app;
}
