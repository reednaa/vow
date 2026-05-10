CREATE TABLE "solana_indexed_events" (
	"chain_id" text NOT NULL,
	"slot" bigint NOT NULL,
	"tx_signature" text NOT NULL,
	"event_index_local" integer NOT NULL,
	"event_index" integer NOT NULL,
	"tree_index" integer NOT NULL,
	"leaf_hash" text NOT NULL,
	"canonical_bytes" text NOT NULL,
	CONSTRAINT "solana_indexed_events_chain_id_slot_event_index_pk" PRIMARY KEY("chain_id","slot","event_index")
);
--> statement-breakpoint
CREATE TABLE "solana_indexed_slots" (
	"chain_id" text NOT NULL,
	"slot" bigint NOT NULL,
	"blockhash" text NOT NULL,
	"merkle_root" text NOT NULL,
	"latest_slot_at_index" bigint NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "solana_indexed_slots_chain_id_slot_pk" PRIMARY KEY("chain_id","slot")
);
--> statement-breakpoint
ALTER TABLE "indexed_blocks" DROP CONSTRAINT "indexed_blocks_chain_id_block_number_pk";
ALTER TABLE "indexed_events" DROP CONSTRAINT "indexed_events_chain_id_block_number_log_index_pk";
DROP INDEX IF EXISTS "idx_events_tree";
--> statement-breakpoint
ALTER TABLE "rpcs" DROP CONSTRAINT "rpcs_chain_id_chains_chain_id_fk";
ALTER TABLE "indexed_blocks" DROP CONSTRAINT "indexed_blocks_chain_id_chains_chain_id_fk";
ALTER TABLE "indexed_events" DROP CONSTRAINT "indexed_events_chain_id_chains_chain_id_fk";
--> statement-breakpoint
ALTER TABLE "chains" DROP CONSTRAINT "chains_pkey";
ALTER TABLE "chains" DROP CONSTRAINT "chains_caip2_unique";
ALTER TABLE "chains" ALTER COLUMN "chain_id" SET DATA TYPE text;
ALTER TABLE "indexed_blocks" ALTER COLUMN "chain_id" SET DATA TYPE text;
ALTER TABLE "indexed_events" ALTER COLUMN "chain_id" SET DATA TYPE text;
ALTER TABLE "rpcs" ALTER COLUMN "chain_id" SET DATA TYPE text;
--> statement-breakpoint
UPDATE "rpcs" SET "chain_id" = 'eip155:' || "chain_id";
UPDATE "indexed_blocks" SET "chain_id" = 'eip155:' || "chain_id";
UPDATE "indexed_events" SET "chain_id" = 'eip155:' || "chain_id";
UPDATE "chains" SET "chain_id" = "caip2";
--> statement-breakpoint
ALTER TABLE "chains" DROP COLUMN "caip2";
ALTER TABLE "chains" ADD PRIMARY KEY ("chain_id");
--> statement-breakpoint
ALTER TABLE "indexed_blocks" ADD CONSTRAINT "indexed_blocks_chain_id_block_number_pk" PRIMARY KEY ("chain_id", "block_number");
ALTER TABLE "indexed_events" ADD CONSTRAINT "indexed_events_chain_id_block_number_log_index_pk" PRIMARY KEY ("chain_id", "block_number", "log_index");
CREATE INDEX "idx_events_tree" ON "indexed_events" USING btree ("chain_id","block_number","tree_index");
--> statement-breakpoint
ALTER TABLE "rpcs" ADD CONSTRAINT "rpcs_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "indexed_blocks" ADD CONSTRAINT "indexed_blocks_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "indexed_events" ADD CONSTRAINT "indexed_events_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "solana_indexed_events" ADD CONSTRAINT "solana_indexed_events_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "solana_indexed_slots" ADD CONSTRAINT "solana_indexed_slots_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_solana_events_tree" ON "solana_indexed_events" USING btree ("chain_id","slot","tree_index");
CREATE INDEX "idx_solana_events_lookup" ON "solana_indexed_events" USING btree ("chain_id","tx_signature","event_index_local");
