import { t, type UnwrapSchema } from "elysia";

export const witnessParams = t.Object({
  caip2ChainId: t.String({ pattern: "^eip155:\\d+$" }),
  blockNumber: t.Numeric({ minimum: 0 }),
  logIndex: t.Numeric({ minimum: 0 }),
});

const witnessEvent = t.Object({
  emitter: t.String(),
  topics: t.Array(t.String()),
  data: t.String(),
});

const witnessReady = t.Object({
  status: t.Literal("ready"),
  witness: t.Object({
    signer: t.String(),
    chainId: t.Number(),
    latestBlockNumber: t.Number(),
    rootBlockNumber: t.Number(),
    root: t.String(),
    blockHash: t.String(),
    proof: t.Array(t.String()),
    signature: t.String(),
    event: witnessEvent,
  }),
});

const witnessStatusOnly = t.Union([
  t.Object({ status: t.Literal("pending") }),
  t.Object({ status: t.Literal("indexing") }),
  t.Object({ status: t.Literal("failed"), error: t.String() }),
  t.Object({ status: t.Literal("error"), error: t.String() }),
]);

const witnessError = t.Object({ error: t.String() });

export const witnessResponse = {
  200: t.Union([witnessReady, witnessStatusOnly]),
  404: witnessError,
};

export type WitnessParams = UnwrapSchema<typeof witnessParams>;
export type WitnessReadyResponse = UnwrapSchema<typeof witnessReady>;

// --- Solana ---

export const solanaWitnessParams = t.Object({
  caip2ChainId: t.String({
    pattern:
      "^solana:(mainnet|5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d|devnet|EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG|testnet|4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY)$",
  }),
  txSignature: t.String(),
  index: t.Numeric({ minimum: 0 }),
});

const solanaWitnessEvent = t.Object({
  programId: t.String(),
  discriminator: t.String(),
  data: t.String(),
});

const solanaWitnessReady = t.Object({
  status: t.Literal("ready"),
  witness: t.Object({
    signer: t.String(),
    chainId: t.Number(),
    latestSlot: t.Number(),
    rootSlot: t.Number(),
    root: t.String(),
    blockhash: t.String(),
    proof: t.Array(t.String()),
    signature: t.String(),
    event: solanaWitnessEvent,
  }),
});

const solanaWitnessStatusOnly = t.Union([
  t.Object({ status: t.Literal("pending") }),
  t.Object({ status: t.Literal("indexing") }),
  t.Object({ status: t.Literal("failed"), error: t.String() }),
  t.Object({ status: t.Literal("error"), error: t.String() }),
]);

const solanaWitnessError = t.Object({ error: t.String() });

export const solanaWitnessResponse = {
  200: t.Union([solanaWitnessReady, solanaWitnessStatusOnly]),
  404: solanaWitnessError,
};

export type SolanaWitnessParams = UnwrapSchema<typeof solanaWitnessParams>;
export type SolanaWitnessReadyResponse = UnwrapSchema<typeof solanaWitnessReady>;
