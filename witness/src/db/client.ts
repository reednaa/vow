import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as graphileWorkerSchema from "./graphile-worker";

const appSchema = { ...schema, ...graphileWorkerSchema };

export type Db = ReturnType<typeof drizzle<typeof appSchema>>;

let _db: Db | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export function createDb(url: string) {
  if (_client) throw new Error("DB already initialized — call closeDb first");
  _client = postgres(url);
  _db = drizzle(_client, { schema: appSchema });
  return _db;
}

export function getDb() {
  if (!_db) throw new Error("DB not initialized — call createDb first");
  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
