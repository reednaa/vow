import { Elysia } from "elysia";
import { mountWitnessHandler, type AddJobFn } from "./witness.handler.ts";

export function createApiServer(port: number, db: any, addJob: AddJobFn) {
  const app = new Elysia()
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
