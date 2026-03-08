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
