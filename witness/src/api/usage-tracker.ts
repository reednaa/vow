import { eq, and, sql } from "drizzle-orm";
import { apiUsage } from "../db/schema.ts";
import type { Db } from "../db/client.ts";

export type UsageTier = "cold" | "hot" | "status";

export async function trackUsage(
  db: Db,
  apiKeyId: number | null,
  tier: UsageTier,
): Promise<void> {
  if (apiKeyId == null || apiKeyId <= 0) return;

  const date = new Date().toISOString().slice(0, 10);

  await db
    .insert(apiUsage)
    .values({
      apiKeyId,
      date,
      coldRequests: tier === "cold" ? 1 : 0,
      hotRequests: tier === "hot" ? 1 : 0,
      statusRequests: tier === "status" ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [apiUsage.apiKeyId, apiUsage.date],
      set: {
        coldRequests: tier === "cold" ? sql`${apiUsage.coldRequests} + 1` : apiUsage.coldRequests,
        hotRequests: tier === "hot" ? sql`${apiUsage.hotRequests} + 1` : apiUsage.hotRequests,
        statusRequests: tier === "status" ? sql`${apiUsage.statusRequests} + 1` : apiUsage.statusRequests,
      },
    });
}
