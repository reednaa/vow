<script lang="ts">
  import "../app.css";
  import { encodeVow } from "$lib/encoding.js";
  import { pollWitness } from "$lib/witnessClient.js";
  import { callProcessVow } from "$lib/contract.js";
  import type { ProofResult, SignedWitness, Step, VowResult, WitnessSource } from "$lib/types.js";
  import type { Address, Hex } from "viem";

  // ── Form state ──────────────────────────────────────────────────────────────

  const DEFAULT_CHAIN_ID = 1;
  const DEFAULT_WITNESS_DIRECTORY = "0x5826BcAc448CA0951789f6EaC3056D07CBf88cF0";
  const DEFAULT_MOCK_VOW_LIB = "0xb484F80cCb6Aa6e1e4c698e70B4ccF790b1cF9b9";

  let chainId = $state(DEFAULT_CHAIN_ID);
  let blockNumber = $state(0);
  let logIndex = $state(0);
  let rpcUrl = $state("");
  let directoryAddress = $state(DEFAULT_WITNESS_DIRECTORY);
  let mockVowLibAddress = $state(DEFAULT_MOCK_VOW_LIB);
  let witnessSources = $state<WitnessSource[]>([{ url: "", signerIndex: 1 }]);

  // ── Execution state ─────────────────────────────────────────────────────────

  let running = $state(false);
  let abortController: AbortController | null = null;

  let proofResults = $state<ProofResult[]>([]);
  let steps = $state<Step[]>([]);
  let vowHex = $state<Hex | null>(null);
  let vowResult = $state<VowResult | null>(null);
  let globalError = $state<string | null>(null);
  let showRawVow = $state(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function addSource() {
    witnessSources = [...witnessSources, { url: "", signerIndex: witnessSources.length + 1 }];
  }

  function removeSource(i: number) {
    witnessSources = witnessSources.filter((_, idx) => idx !== i);
  }

  function setStep(index: number, state: Step["state"], detail?: string) {
    steps = steps.map((s, i) => (i === index ? { ...s, state, detail } : s));
  }

  function validate(): string | null {
    if (!chainId || chainId < 1) return "Chain ID must be a positive integer";
    if (blockNumber < 0) return "Block number must be >= 0";
    if (logIndex < 0) return "Log index must be >= 0";
    if (!rpcUrl.trim()) return "RPC URL is required";
    if (!directoryAddress.trim()) return "WitnessDirectory address is required";
    if (!mockVowLibAddress.trim()) return "MockVowLib address is required";
    if (witnessSources.length === 0) return "At least one witness source is required";
    for (const [i, src] of witnessSources.entries()) {
      if (!src.url.trim()) return `Witness source ${i + 1}: URL is required`;
      if (src.signerIndex < 1 || src.signerIndex > 255)
        return `Witness source ${i + 1}: signer index must be 1–255`;
    }
    const indices = witnessSources.map((s) => s.signerIndex);
    if (new Set(indices).size !== indices.length) return "Signer indices must be unique";
    return null;
  }

  async function run() {
    globalError = validate();
    if (globalError) return;

    running = true;
    vowHex = null;
    vowResult = null;
    globalError = null;
    abortController = new AbortController();

    proofResults = witnessSources.map((source) => ({ source, status: "polling" as const }));

    steps = [
      { label: "Fetching proofs", state: "running" },
      { label: "Encoding Vow", state: "idle" },
      { label: "Calling on-chain", state: "idle" },
      { label: "Done", state: "idle" },
    ];

    try {
      // ── Step 1: fetch all proofs ───────────────────────────────────────────
      const settled = await Promise.allSettled(
        witnessSources.map((src, i) =>
          pollWitness(src.url, chainId, blockNumber, logIndex, {
            signal: abortController!.signal,
            onStatus: (status) => {
              proofResults = proofResults.map((r, idx) =>
                idx === i ? { ...r, status: status === "ready" ? "ready" : "polling" } : r
              );
            },
          }).then((witness) => {
            proofResults = proofResults.map((r, idx) =>
              idx === i ? { ...r, status: "ready", witness } : r
            );
            return witness;
          })
        )
      );

      const failures = settled
        .map((r, i) => (r.status === "rejected" ? { i, reason: r.reason } : null))
        .filter(Boolean) as { i: number; reason: unknown }[];

      for (const { i, reason } of failures) {
        proofResults = proofResults.map((r, idx) =>
          idx === i
            ? { ...r, status: "failed", error: reason instanceof Error ? reason.message : String(reason) }
            : r
        );
      }

      if (failures.length > 0) {
        throw new Error(`${failures.length} witness(es) failed — see details above`);
      }

      setStep(0, "done");

      // ── Step 2: encode vow ────────────────────────────────────────────────
      setStep(1, "running");

      const signedWitnesses: SignedWitness[] = settled.map((r, i) => ({
        witness: (r as PromiseFulfilledResult<(typeof proofResults)[0]["witness"]>).value!,
        signerIndex: witnessSources[i]!.signerIndex,
      }));

      vowHex = encodeVow(signedWitnesses);
      setStep(1, "done", `${(vowHex.length - 2) / 2} bytes`);

      // ── Step 3: on-chain call ─────────────────────────────────────────────
      setStep(2, "running");

      vowResult = await callProcessVow(
        rpcUrl,
        mockVowLibAddress as Address,
        directoryAddress as Address,
        vowHex
      );

      setStep(2, "done");
      setStep(3, "done");
    } catch (err) {
      globalError = err instanceof Error ? err.message : String(err);
      // Mark any still-running step as error
      steps = steps.map((s) => (s.state === "running" ? { ...s, state: "error" } : s));
    } finally {
      running = false;
    }
  }

  function cancel() {
    abortController?.abort();
    running = false;
  }

  // ── Derived display helpers ──────────────────────────────────────────────

  const stepIcon: Record<Step["state"], string> = {
    idle: "○",
    running: "◌",
    done: "✓",
    error: "✗",
  };

  const stepColor: Record<Step["state"], string> = {
    idle: "text-gray-400",
    running: "text-blue-400",
    done: "text-green-400",
    error: "text-red-400",
  };
</script>

<svelte:head>
  <title>Vow Demo</title>
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-10 font-mono text-sm text-gray-100">
  <h1 class="mb-1 text-2xl font-bold tracking-tight text-white">Vow Demo</h1>
  <p class="mb-8 text-gray-400">
    Collect witness proofs for an on-chain event, encode a Vow, and verify it on-chain.
  </p>

  <!-- ── Form ──────────────────────────────────────────────────────────────── -->
  <form
    onsubmit={(e) => {
      e.preventDefault();
      run();
    }}
    class="space-y-6"
  >
    <!-- Event coordinates -->
    <section>
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        Event
      </h2>
      <div class="grid grid-cols-3 gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-gray-400">Chain ID</span>
          <input
            type="number"
            min="1"
            bind:value={chainId}
            disabled
            class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            placeholder="1"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-gray-400">Block Number</span>
          <input
            type="number"
            min="0"
            bind:value={blockNumber}
            class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            placeholder="0"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-gray-400">Log Index</span>
          <input
            type="number"
            min="0"
            bind:value={logIndex}
            class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            placeholder="0"
          />
        </label>
      </div>
    </section>

    <!-- Chain / Contract config -->
    <section>
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        Chain
      </h2>
      <div class="space-y-3">
        <label class="flex flex-col gap-1">
          <span class="text-gray-400">RPC URL</span>
          <input
            type="url"
            bind:value={rpcUrl}
            class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            placeholder="https://rpc.example.com"
          />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-gray-400">WitnessDirectory</span>
            <input
              type="text"
              bind:value={directoryAddress}
              disabled
              class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="0x…"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-gray-400">MockVowLib</span>
            <input
              type="text"
              bind:value={mockVowLibAddress}
              disabled
              class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="0x…"
            />
          </label>
        </div>
      </div>
    </section>

    <!-- Witness sources -->
    <section>
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        Witness Sources
      </h2>
      <div class="space-y-2">
        {#each witnessSources as src, i (i)}
          <div class="flex items-center gap-2">
            <input
              type="url"
              bind:value={src.url}
              class="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="https://witness.example.com"
            />
            <label class="flex items-center gap-1 whitespace-nowrap text-gray-400">
              idx
              <input
                type="number"
                min="1"
                max="255"
                bind:value={src.signerIndex}
                class="w-16 rounded border border-gray-700 bg-gray-900 px-2 py-2 text-white focus:border-blue-500 focus:outline-none"
              />
            </label>
            {#if witnessSources.length > 1}
              <button
                type="button"
                onclick={() => removeSource(i)}
                class="text-gray-500 hover:text-red-400"
                aria-label="Remove witness source"
              >
                ✕
              </button>
            {/if}
          </div>
        {/each}
        <button
          type="button"
          onclick={addSource}
          class="text-blue-400 hover:text-blue-300"
        >
          + Add witness
        </button>
      </div>
    </section>

    <!-- Submit -->
    <div class="flex gap-3">
      {#if running}
        <button
          type="button"
          onclick={cancel}
          class="rounded bg-red-700 px-5 py-2 font-semibold text-white hover:bg-red-600"
        >
          Cancel
        </button>
      {:else}
        <button
          type="submit"
          class="rounded bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-500"
        >
          Run
        </button>
      {/if}
    </div>
  </form>

  <!-- ── Validation / global error ────────────────────────────────────────── -->
  {#if globalError && steps.length === 0}
    <div
      data-testid="validation-error"
      class="mt-6 rounded border border-red-700 bg-red-950 px-4 py-3 text-red-300"
    >
      {globalError}
    </div>
  {/if}

  <!-- ── Progress ──────────────────────────────────────────────────────────── -->
  {#if steps.length > 0}
    <div class="mt-8 space-y-1" data-testid="steps">
      {#each steps as step}
        <div class="flex items-baseline gap-2">
          <span class={stepColor[step.state]}>{stepIcon[step.state]}</span>
          <span class={step.state === "idle" ? "text-gray-500" : "text-gray-200"}>
            {step.label}
          </span>
          {#if step.detail}
            <span class="text-gray-500">— {step.detail}</span>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Per-witness status -->
    {#if proofResults.length > 0}
      <div class="mt-4 space-y-1" data-testid="proof-results">
        {#each proofResults as r}
          <div class="flex items-start gap-2 text-xs">
            <span
              class={r.status === "ready"
                ? "text-green-400"
                : r.status === "failed"
                  ? "text-red-400"
                  : "text-blue-400"}
            >
              {r.status === "ready" ? "✓" : r.status === "failed" ? "✗" : "◌"}
            </span>
            <span class="text-gray-400 break-all">{r.source.url}</span>
            {#if r.status === "failed" && r.error}
              <span class="text-red-400">— {r.error}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Global error after running -->
    {#if globalError && steps.length > 0}
      <div
        data-testid="run-error"
        class="mt-4 rounded border border-red-700 bg-red-950 px-4 py-3 text-red-300"
      >
        {globalError}
      </div>
    {/if}
  {/if}

  <!-- ── Raw Vow ────────────────────────────────────────────────────────────── -->
  {#if vowHex}
    <div class="mt-6">
      <button
        type="button"
        onclick={() => (showRawVow = !showRawVow)}
        class="text-xs text-gray-500 hover:text-gray-300"
      >
        {showRawVow ? "▼" : "▶"} Raw vow bytes ({(vowHex.length - 2) / 2} bytes)
      </button>
      {#if showRawVow}
        <pre
          data-testid="vow-hex"
          class="mt-2 overflow-x-auto rounded border border-gray-700 bg-gray-900 px-4 py-3 text-xs text-gray-300 break-all whitespace-pre-wrap"
        >{vowHex}</pre>
      {/if}
    </div>
  {/if}

  <!-- ── Result ─────────────────────────────────────────────────────────────── -->
  {#if vowResult}
    <div class="mt-6" data-testid="result">
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        Result
      </h2>
      <table class="w-full border-collapse text-xs">
        <tbody>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 text-gray-500">chainId</td>
            <td class="py-2 text-gray-200" data-testid="result-chainId"
              >{vowResult.chainId.toString()}</td
            >
          </tr>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 text-gray-500">rootBlockNumber</td>
            <td class="py-2 text-gray-200" data-testid="result-rootBlockNumber"
              >{vowResult.rootBlockNumber.toString()}</td
            >
          </tr>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 text-gray-500">emitter</td>
            <td class="py-2 font-mono text-gray-200 break-all" data-testid="result-emitter"
              >{vowResult.emitter}</td
            >
          </tr>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 align-top text-gray-500">topics</td>
            <td class="py-2 text-gray-200" data-testid="result-topics">
              {#each vowResult.topics as topic, i}
                <div class="break-all">[{i}] {topic}</div>
              {/each}
            </td>
          </tr>
          <tr>
            <td class="py-2 pr-4 align-top text-gray-500">data</td>
            <td class="py-2 break-all text-gray-200" data-testid="result-data"
              >{vowResult.data}</td
            >
          </tr>
        </tbody>
      </table>
    </div>
  {/if}
</main>
