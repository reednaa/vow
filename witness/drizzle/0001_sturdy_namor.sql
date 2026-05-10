CREATE TABLE "solana_indexed_events" (
	"chain_id" integer NOT NULL,
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
	"chain_id" integer NOT NULL,
	"slot" bigint NOT NULL,
	"blockhash" text NOT NULL,
	"merkle_root" text NOT NULL,
	"latest_slot_at_index" bigint NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "solana_indexed_slots_chain_id_slot_pk" PRIMARY KEY("chain_id","slot")
);
--> statement-breakpoint
ALTER TABLE "solana_indexed_events" ADD CONSTRAINT "solana_indexed_events_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solana_indexed_slots" ADD CONSTRAINT "solana_indexed_slots_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_solana_events_tree" ON "solana_indexed_events" USING btree ("chain_id","slot","tree_index");--> statement-breakpoint
CREATE INDEX "idx_solana_events_lookup" ON "solana_indexed_events" USING btree ("chain_id","tx_signature","event_index_local");