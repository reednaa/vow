import { pgTable, integer, bigint, text, timestamp, serial, boolean, unique, primaryKey, index } from "drizzle-orm/pg-core";

export const chains = pgTable("chains", {
  chainId: text("chain_id").primaryKey().notNull(),
  latestBlock: bigint("latest_block", { mode: "bigint" }),
  confirmations: integer("confirmations").notNull().default(12),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const rpcs = pgTable("rpcs", {
  id: serial("id").primaryKey(),
  chainId: text("chain_id").notNull().references(() => chains.chainId),
  url: text("url").notNull(),
});

export const indexedBlocks = pgTable("indexed_blocks", {
  chainId: text("chain_id").notNull().references(() => chains.chainId),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: text("block_hash").notNull(),
  merkleRoot: text("merkle_root").notNull(),
  latestBlockAtIndex: bigint("latest_block_at_index", { mode: "bigint" }).notNull(),
  signature: text("signature").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockNumber] }),
]);

export const indexedEvents = pgTable("indexed_events", {
  chainId: text("chain_id").notNull().references(() => chains.chainId),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  logIndex: integer("log_index").notNull(),
  leafHash: text("leaf_hash").notNull(),
  canonicalBytes: text("canonical_bytes").notNull(),
  treeIndex: integer("tree_index").notNull(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockNumber, table.logIndex] }),
  index("idx_events_tree").on(table.chainId, table.blockNumber, table.treeIndex),
]);

// --- Solana tables ---

export const solanaIndexedSlots = pgTable("solana_indexed_slots", {
  chainId: text("chain_id").notNull().references(() => chains.chainId),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  blockhash: text("blockhash").notNull(),
  merkleRoot: text("merkle_root").notNull(),
  latestSlotAtIndex: bigint("latest_slot_at_index", { mode: "bigint" }).notNull(),
  signature: text("signature").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.slot] }),
]);

export const solanaIndexedEvents = pgTable("solana_indexed_events", {
  chainId: text("chain_id").notNull().references(() => chains.chainId),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  txSignature: text("tx_signature").notNull(),
  eventIndexLocal: integer("event_index_local").notNull(),
  eventIndex: integer("event_index").notNull(),
  treeIndex: integer("tree_index").notNull(),
  leafHash: text("leaf_hash").notNull(),
  canonicalBytes: text("canonical_bytes").notNull(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.slot, table.eventIndex] }),
  index("idx_solana_events_tree").on(table.chainId, table.slot, table.treeIndex),
  index("idx_solana_events_lookup").on(table.chainId, table.txSignature, table.eventIndexLocal),
]);

// --- API keys ---

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  createdBy: text("created_by").notNull().default("admin"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const apiUsage = pgTable("api_usage", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeys.id),
  date: text("date").notNull(),
  coldRequests: integer("cold_requests").notNull().default(0),
  hotRequests: integer("hot_requests").notNull().default(0),
  statusRequests: integer("status_requests").notNull().default(0),
}, (table) => [
  unique("uq_api_usage_key_date").on(table.apiKeyId, table.date),
]);
