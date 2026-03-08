CREATE TABLE "chains" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"caip2" text NOT NULL,
	"latest_block" bigint,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "chains_caip2_unique" UNIQUE("caip2")
);
--> statement-breakpoint
CREATE TABLE "indexed_blocks" (
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"merkle_root" text NOT NULL,
	"latest_block_at_index" bigint NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "indexed_blocks_chain_id_block_number_pk" PRIMARY KEY("chain_id","block_number")
);
--> statement-breakpoint
CREATE TABLE "indexed_events" (
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"leaf_hash" text NOT NULL,
	"canonical_bytes" text NOT NULL,
	"tree_index" integer NOT NULL,
	CONSTRAINT "indexed_events_chain_id_block_number_log_index_pk" PRIMARY KEY("chain_id","block_number","log_index")
);
--> statement-breakpoint
CREATE TABLE "rpcs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"url" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "indexed_blocks" ADD CONSTRAINT "indexed_blocks_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexed_events" ADD CONSTRAINT "indexed_events_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rpcs" ADD CONSTRAINT "rpcs_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_tree" ON "indexed_events" USING btree ("chain_id","block_number","tree_index");