import { pgTable, integer, bigint, text, timestamp, serial, primaryKey, index } from "drizzle-orm/pg-core";

export const chains = pgTable("chains", {
  chainId: text("chain_id").primaryKey().notNull(),
  latestBlock: bigint("latest_block", { mode: "bigint" }),
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
