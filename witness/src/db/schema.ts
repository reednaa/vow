import { pgTable, integer, bigint, text, timestamp, serial, primaryKey, index } from "drizzle-orm/pg-core";

export const chains = pgTable("chains", {
  chainId: integer("chain_id").primaryKey(),           // Numeric chain ID (e.g., 1)
  caip2: text("caip2").notNull().unique(),             // CAIP-2 identifier (e.g., "eip155:1")
  latestBlock: bigint("latest_block", { mode: "bigint" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const rpcs = pgTable("rpcs", {
  id: serial("id").primaryKey(),
  chainId: integer("chain_id").notNull().references(() => chains.chainId),
  url: text("url").notNull(),
});

export const indexedBlocks = pgTable("indexed_blocks", {
  chainId: integer("chain_id").notNull().references(() => chains.chainId),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: text("block_hash").notNull(),             // 0x-prefixed hex, 32 bytes
  merkleRoot: text("merkle_root").notNull(),           // 0x-prefixed hex, 32 bytes
  latestBlockAtIndex: bigint("latest_block_at_index", { mode: "bigint" }).notNull(),
  signature: text("signature").notNull(),              // 0x-prefixed packed signature hex
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockNumber] }),
]);

export const indexedEvents = pgTable("indexed_events", {
  chainId: integer("chain_id").notNull().references(() => chains.chainId),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  logIndex: integer("log_index").notNull(),            // Position in the block's log array
  leafHash: text("leaf_hash").notNull(),               // 0x-prefixed hex, keccak256(keccak256(...))
  canonicalBytes: text("canonical_bytes").notNull(),   // 0x-prefixed hex, raw canonical encoding
  treeIndex: integer("tree_index").notNull(),          // Position in sorted Merkle tree (by leaf_hash asc)
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockNumber, table.logIndex] }),
  index("idx_events_tree").on(table.chainId, table.blockNumber, table.treeIndex),
]);

// --- Solana tables ---

export const solanaIndexedSlots = pgTable("solana_indexed_slots", {
  chainId: integer("chain_id").notNull().references(() => chains.chainId),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  blockhash: text("blockhash").notNull(),           // base58-encoded block hash
  merkleRoot: text("merkle_root").notNull(),        // 0x-prefixed hex, 32 bytes
  latestSlotAtIndex: bigint("latest_slot_at_index", { mode: "bigint" }).notNull(),
  signature: text("signature").notNull(),           // 0x-prefixed packed EIP-712 signature hex
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.slot] }),
]);

export const solanaIndexedEvents = pgTable("solana_indexed_events", {
  chainId: integer("chain_id").notNull().references(() => chains.chainId),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  txSignature: text("tx_signature").notNull(),      // base58-encoded transaction signature
  eventIndexLocal: integer("event_index_local").notNull(),  // 0-based position within tx
  eventIndex: integer("event_index").notNull(),     // global ordinal within the slot
  treeIndex: integer("tree_index").notNull(),       // position in sorted Merkle tree
  leafHash: text("leaf_hash").notNull(),            // 0x-prefixed hex, keccak256(keccak256(canonical))
  canonicalBytes: text("canonical_bytes").notNull(), // 0x-prefixed hex, raw canonical encoding
}, (table) => [
  primaryKey({ columns: [table.chainId, table.slot, table.eventIndex] }),
  index("idx_solana_events_tree").on(table.chainId, table.slot, table.treeIndex),
  index("idx_solana_events_lookup").on(table.chainId, table.txSignature, table.eventIndexLocal),
]);
