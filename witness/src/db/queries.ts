import { eq, inArray, sql } from "drizzle-orm";
import { solanaIndexedSlots } from "./schema.ts";
import type { Db } from "./client.ts";

export async function getSolanaLatestSlots(
  db: Db,
  chainIds: string[],
): Promise<Map<string, bigint>> {
  const map = new Map<string, bigint>();
  if (chainIds.length === 0) return map;

  const rows = await db
    .select({
      chainId: solanaIndexedSlots.chainId,
      maxSlot: sql<bigint>`max(${solanaIndexedSlots.latestSlotAtIndex})`.mapWith(Number),
    })
    .from(solanaIndexedSlots)
    .where(inArray(solanaIndexedSlots.chainId, chainIds))
    .groupBy(solanaIndexedSlots.chainId);

  for (const row of rows) {
    map.set(row.chainId, BigInt(row.maxSlot));
  }
  return map;
}

export async function getSolanaLatestSlot(
  db: Db,
  chainId: string,
): Promise<bigint | null> {
  const [row] = await db
    .select({
      maxSlot: sql<bigint>`max(${solanaIndexedSlots.latestSlotAtIndex})`.mapWith(Number),
    })
    .from(solanaIndexedSlots)
    .where(eq(solanaIndexedSlots.chainId, chainId));

  return row?.maxSlot ? BigInt(row.maxSlot) : null;
}
