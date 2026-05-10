<script lang="ts">
  import { ETHEREUM_MAINNET_CHAIN_ID, SOLANA_MAINNET_CHAIN_ID } from "$lib/chain.js";
  import { encodeVow } from "$lib/encoding.js";
  import { callProcessVow, decodeVowEvent, getDirectorySigner } from "$lib/contract.js";
  import { pollWitness } from "$lib/witnessClient.js";
  import type {
    DecodedEthereumEvent,
    DecodedSolanaEvent,
    DecodedVowResult,
    DemoSourceMode,
    ProofResult,
    SignedWitness,
    Step,
    WitnessRequest,
    WitnessResult,
    WitnessSource,
  } from "$lib/types.js";
  import type { Address, Hex } from "viem";

  const DEFAULT_WITNESS_DIRECTORY = "0x0bCd1123AfB2088084847bF4B4b10C2B2dfa5963";
  const DEFAULT_MOCK_VOW_LIB = "0xb58fB4D3eA84Eb4845Fc7e1CC727b307f26fd856";
  const DEFAULT_RPC_URL = "https://ethereum-rpc.publicnode.com";
  const DEFAULT_ETHEREUM_BLOCK_NUMBER = 25_061_118;
  const DEFAULT_ETHEREUM_LOG_INDEX = 2820;
  const DEFAULT_SOLANA_TX_SIGNATURE =
    "HYtVCbkEaJ1tVqwEvfDUJQg1T65g1wtiFJJyVo9TZEygezeA9aTUTaZTZ2hJDumns4C4WnGDEp7387u2UAE2ukY";
  const DEFAULT_SOLANA_EVENT_INDEX = 0;

  const SOURCE_CHAIN_IDS = {
    ethereum: ETHEREUM_MAINNET_CHAIN_ID,
    solana: SOLANA_MAINNET_CHAIN_ID,
  } as const satisfies Record<DemoSourceMode, string>;

  const SOURCE_LABELS = {
    ethereum: "Ethereum (decodeEvent)",
    solana: "Solana (decodeEmitCPI)",
  } as const satisfies Record<DemoSourceMode, string>;

  // ── Form state ──────────────────────────────────────────────────────────────

  let sourceMode = $state<DemoSourceMode>("ethereum");
  let ethereumBlockNumber = $state(DEFAULT_ETHEREUM_BLOCK_NUMBER);
  let ethereumLogIndex = $state(DEFAULT_ETHEREUM_LOG_INDEX);
  let solanaTxSignature = $state(DEFAULT_SOLANA_TX_SIGNATURE);
  let solanaEventIndex = $state(DEFAULT_SOLANA_EVENT_INDEX);
  let rpcUrl = $state(DEFAULT_RPC_URL);
  let directoryAddress = $state(DEFAULT_WITNESS_DIRECTORY);
  let mockVowLibAddress = $state(DEFAULT_MOCK_VOW_LIB);
  let witnessSources = $state<WitnessSource[]>([{ url: "https://witness.vav.me", signerIndex: 1 }]);

  // ── Execution state ─────────────────────────────────────────────────────────

  let running = $state(false);
  let abortController: AbortController | null = null;

  let proofResults = $state<ProofResult[]>([]);
  let steps = $state<Step[]>([]);
  let vowHex = $state<Hex | null>(null);
  let decodedVowResult = $state<DecodedVowResult | null>(null);
  let processVowGasEstimate = $state<bigint | null>(null);
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

  function resetRunOutput() {
    vowHex = null;
    decodedVowResult = null;
    processVowGasEstimate = null;
    globalError = null;
    showRawVow = false;
    proofResults = [];
    steps = [];
  }

  function resetSourceDefaults(mode: DemoSourceMode) {
    if (mode === "ethereum") {
      ethereumBlockNumber = DEFAULT_ETHEREUM_BLOCK_NUMBER;
      ethereumLogIndex = DEFAULT_ETHEREUM_LOG_INDEX;
      return;
    }

    solanaTxSignature = DEFAULT_SOLANA_TX_SIGNATURE;
    solanaEventIndex = DEFAULT_SOLANA_EVENT_INDEX;
  }

  function setSourceMode(mode: DemoSourceMode) {
    if (mode === sourceMode) return;
    sourceMode = mode;
    resetSourceDefaults(mode);
    resetRunOutput();
  }

  function currentSourceChainId(mode: DemoSourceMode = sourceMode): string {
    return SOURCE_CHAIN_IDS[mode];
  }

  function buildWitnessRequest(): WitnessRequest {
    if (sourceMode === "ethereum") {
      return {
        mode: "ethereum",
        chainId: currentSourceChainId(),
        blockNumber: ethereumBlockNumber,
        logIndex: ethereumLogIndex,
      };
    }

    return {
      mode: "solana",
      chainId: currentSourceChainId(),
      txSignature: solanaTxSignature.trim(),
      index: solanaEventIndex,
    };
  }

  function validate(): string | null {
    if (sourceMode === "ethereum") {
      if (ethereumBlockNumber < 0) return "Block number must be >= 0";
      if (ethereumLogIndex < 0) return "Log index must be >= 0";
    } else {
      if (!solanaTxSignature.trim()) return "Transaction signature is required";
      if (solanaEventIndex < 0) return "Event index must be >= 0";
    }
    if (!rpcUrl.trim()) return "RPC URL is required";
    if (!directoryAddress.trim()) return "WitnessDirectory address is required";
    if (!mockVowLibAddress.trim()) return "MockVowLib address is required";
    if (witnessSources.length === 0) return "At least one witness source is required";
    for (const [i, src] of witnessSources.entries()) {
      if (!src.url.trim()) return `Witness source ${i + 1}: URL is required`;
      if (src.signerIndex < 1 || src.signerIndex > 255) {
        return `Witness source ${i + 1}: signer index must be 1–255`;
      }
    }
    const indices = witnessSources.map((source) => source.signerIndex);
    if (new Set(indices).size !== indices.length) return "Signer indices must be unique";
    return null;
  }

  async function run() {
    globalError = validate();
    if (globalError) return;

    running = true;
    resetRunOutput();
    abortController = new AbortController();

    proofResults = witnessSources.map((source) => ({ source, status: "polling" as const }));
    steps = [
      { label: "Fetching proofs", state: "running" },
      { label: "Validating signers", state: "idle" },
      { label: "Encoding Vow", state: "idle" },
      { label: "Calling processVow", state: "idle" },
      {
        label: `Decoding evt with ${sourceMode === "ethereum" ? "decodeEvent" : "decodeEmitCPI"}`,
        state: "idle",
      },
      { label: "Done", state: "idle" },
    ];

    const request = buildWitnessRequest();

    try {
      const settled = await Promise.allSettled(
        witnessSources.map((src, i) =>
          pollWitness(src.url, request, {
            signal: abortController!.signal,
            onStatus: (status) => {
              proofResults = proofResults.map((result, idx) =>
                idx === i ? { ...result, status: status === "ready" ? "ready" : "polling" } : result
              );
            },
          }).then((witness) => {
            proofResults = proofResults.map((result, idx) =>
              idx === i ? { ...result, status: "ready", witness } : result
            );
            return witness;
          })
        )
      );

      const failures = settled
        .map((result, i) => (result.status === "rejected" ? { i, reason: result.reason } : null))
        .filter(Boolean) as { i: number; reason: unknown }[];

      for (const { i, reason } of failures) {
        proofResults = proofResults.map((result, idx) =>
          idx === i
            ? {
                ...result,
                status: "failed",
                error: reason instanceof Error ? reason.message : String(reason),
              }
            : result
        );
      }

      if (failures.length > 0) {
        throw new Error(`${failures.length} witness(es) failed — see details above`);
      }

      setStep(0, "done");

      const readyWitnesses = settled.map(
        (result) => (result as PromiseFulfilledResult<WitnessResult>).value
      );

      setStep(1, "running");

      const signerChecks = await Promise.allSettled(
        witnessSources.map(async (src, i) => {
          const witness = readyWitnesses[i]!;
          const onChainSigner = await getDirectorySigner(
            rpcUrl,
            directoryAddress as Address,
            src.signerIndex
          );
          const witnessSigner = witness.signer;
          const matches = onChainSigner.toLowerCase() === witnessSigner.toLowerCase();

          proofResults = proofResults.map((result, idx) =>
            idx === i
              ? {
                  ...result,
                  status: matches ? "ready" : "failed",
                  error: matches ? undefined : `Signer mismatch at idx ${src.signerIndex}`,
                  signerMatch: {
                    selectedIndex: src.signerIndex,
                    witnessSigner,
                    onChainSigner,
                    matches,
                  },
                }
              : result
          );

          if (!matches) {
            throw new Error(
              `Witness ${i + 1} (${src.url}) signer ${witnessSigner} does not match on-chain signer ${onChainSigner} at index ${src.signerIndex}`
            );
          }
        })
      );

      const signerFailures = signerChecks
        .map((result, i) => (result.status === "rejected" ? { i, reason: result.reason } : null))
        .filter(Boolean) as { i: number; reason: unknown }[];

      for (const { i, reason } of signerFailures) {
        proofResults = proofResults.map((result, idx) =>
          idx === i
            ? {
                ...result,
                status: "failed",
                error: reason instanceof Error ? reason.message : String(reason),
              }
            : result
        );
      }

      if (signerFailures.length > 0) {
        throw new Error(
          `${signerFailures.length} signer validation failure(s) — see details above`
        );
      }

      setStep(1, "done");
      setStep(2, "running");

      const signedWitnesses: SignedWitness[] = readyWitnesses.map((witness, i) => ({
        witness,
        signerIndex: witnessSources[i]!.signerIndex,
      }));

      vowHex = encodeVow(signedWitnesses);
      setStep(2, "done", `${(vowHex.length - 2) / 2} bytes`);

      setStep(3, "running");

      const processVowCall = await callProcessVow(
        rpcUrl,
        mockVowLibAddress as Address,
        directoryAddress as Address,
        vowHex
      );

      processVowGasEstimate = processVowCall.gasEstimate;
      setStep(3, "done", `${processVowGasEstimate.toString()} gas`);

      setStep(4, "running");

      const decodedEvent = await decodeVowEvent(
        rpcUrl,
        mockVowLibAddress as Address,
        sourceMode,
        processVowCall.processVowResult.evt
      );

      decodedVowResult =
        sourceMode === "ethereum"
          ? {
              mode: "ethereum",
              processVowResult: processVowCall.processVowResult,
              decodedEvent: decodedEvent as DecodedEthereumEvent,
            }
          : {
              mode: "solana",
              processVowResult: processVowCall.processVowResult,
              decodedEvent: decodedEvent as DecodedSolanaEvent,
            };

      setStep(4, "done");
      setStep(5, "done");
    } catch (err) {
      globalError = err instanceof Error ? err.message : String(err);
      steps = steps.map((step) => (step.state === "running" ? { ...step, state: "error" } : step));
    } finally {
      running = false;
      abortController = null;
    }
  }

  function cancel() {
    abortController?.abort();
    running = false;
  }

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
    Choose a source chain, collect witness proofs, verify the Vow on-chain, and then decode the raw
    event bytes explicitly.
  </p>

  <form
    onsubmit={(e) => {
      e.preventDefault();
      run();
    }}
    class="space-y-6"
  >
    <section>
      <h2 class="mb-3 text-xs font-semibold tracking-widest text-gray-500 uppercase">
        Source Event
      </h2>
      <div class="space-y-3">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-gray-400">Source Mode</span>
            <select
              value={sourceMode}
              onchange={(event) =>
                setSourceMode((event.currentTarget as HTMLSelectElement).value as DemoSourceMode)}
              disabled={running}
              class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="ethereum">{SOURCE_LABELS.ethereum}</option>
              <option value="solana">{SOURCE_LABELS.solana}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-gray-400">Source Chain ID</span>
            <input
              type="text"
              value={currentSourceChainId()}
              disabled
              class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white"
            />
          </label>
        </div>

        {#if sourceMode === "ethereum"}
          <div class="grid gap-3 md:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="text-gray-400">Block Number</span>
              <input
                type="number"
                min="0"
                bind:value={ethereumBlockNumber}
                class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                placeholder="25061118"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-gray-400">Log Index</span>
              <input
                type="number"
                min="0"
                bind:value={ethereumLogIndex}
                class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                placeholder="2820"
              />
            </label>
          </div>
        {:else}
          <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
            <label class="flex flex-col gap-1">
              <span class="text-gray-400">Transaction Signature</span>
              <input
                type="text"
                bind:value={solanaTxSignature}
                class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                placeholder={DEFAULT_SOLANA_TX_SIGNATURE}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-gray-400">Event Index</span>
              <input
                type="number"
                min="0"
                bind:value={solanaEventIndex}
                class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                placeholder="0"
              />
            </label>
          </div>
        {/if}
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-xs font-semibold tracking-widest text-gray-500 uppercase">
        Verifier Chain
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
        <div class="grid gap-3 md:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-gray-400">WitnessDirectory</span>
            <input
              type="text"
              bind:value={directoryAddress}
              disabled
              class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white"
              placeholder="0x…"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-gray-400">MockVowLib</span>
            <input
              type="text"
              bind:value={mockVowLibAddress}
              disabled
              class="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white"
              placeholder="0x…"
            />
          </label>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-xs font-semibold tracking-widest text-gray-500 uppercase">
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
        <button type="button" onclick={addSource} class="text-blue-400 hover:text-blue-300">
          + Add witness
        </button>
      </div>
    </section>

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

  {#if globalError && steps.length === 0}
    <div
      data-testid="validation-error"
      class="mt-6 rounded border border-red-700 bg-red-950 px-4 py-3 text-red-300"
    >
      {globalError}
    </div>
  {/if}

  {#if steps.length > 0}
    <div class="mt-8 space-y-1" data-testid="steps">
      {#each steps as step (step.label)}
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

    {#if proofResults.length > 0}
      <div class="mt-4 space-y-1" data-testid="proof-results">
        {#each proofResults as result (`${result.source.url}:${result.source.signerIndex}`)}
          <div class="flex items-start gap-2 text-xs">
            <span
              class={result.status === "ready"
                ? "text-green-400"
                : result.status === "failed"
                  ? "text-red-400"
                  : "text-blue-400"}
            >
              {result.status === "ready" ? "✓" : result.status === "failed" ? "✗" : "◌"}
            </span>
            <span class="break-all text-gray-400">{result.source.url}</span>
            {#if result.signerMatch}
              <span
                class={`break-all ${result.signerMatch.matches ? "text-green-500" : "text-red-400"}`}
              >
                — idx {result.signerMatch.selectedIndex} witness {result.signerMatch.witnessSigner}
                on-chain {result.signerMatch.onChainSigner}
              </span>
            {:else if result.witness}
              <span class="break-all text-gray-500">
                — idx {result.source.signerIndex} witness {result.witness.signer}
              </span>
            {/if}
            {#if result.status === "failed" && result.error}
              <span class="text-red-400">— {result.error}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if globalError && steps.length > 0}
      <div
        data-testid="run-error"
        class="mt-4 rounded border border-red-700 bg-red-950 px-4 py-3 text-red-300"
      >
        {globalError}
      </div>
    {/if}
  {/if}

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
          class="mt-2 overflow-x-auto rounded border border-gray-700 bg-gray-900 px-4 py-3 text-xs break-all whitespace-pre-wrap text-gray-300">{vowHex}</pre>
      {/if}
    </div>
  {/if}

  {#if decodedVowResult}
    <div
      class="mt-6 rounded-lg border border-gray-700 bg-gray-950/90 px-4 py-4"
      data-testid="result"
    >
      <h2 class="mb-3 text-xs font-semibold tracking-widest text-gray-400 uppercase">Result</h2>
      <table class="w-full border-collapse text-xs">
        <tbody>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 text-gray-500">decoder</td>
            <td class="py-2 text-gray-200" data-testid="result-decoder">
              {SOURCE_LABELS[decodedVowResult.mode]}
            </td>
          </tr>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 text-gray-500">chainId</td>
            <td class="py-2 text-gray-200" data-testid="result-chainId">
              {decodedVowResult.processVowResult.chainId.toString()}
            </td>
          </tr>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 text-gray-500">
              {decodedVowResult.mode === "ethereum" ? "rootBlockNumber" : "rootSlot"}
            </td>
            <td class="py-2 text-gray-200" data-testid="result-rootBlockNumber">
              {decodedVowResult.processVowResult.rootBlockNumber.toString()}
            </td>
          </tr>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 text-gray-500">processVowGas</td>
            <td class="py-2 text-gray-200" data-testid="result-gas-estimate">
              {processVowGasEstimate?.toString() ?? "n/a"}
            </td>
          </tr>
          <tr class="border-b border-gray-800">
            <td class="py-2 pr-4 align-top text-gray-500">evt</td>
            <td class="py-2 break-all text-gray-200" data-testid="result-evt">
              {decodedVowResult.processVowResult.evt}
            </td>
          </tr>
          {#if decodedVowResult.mode === "ethereum"}
            <tr class="border-b border-gray-800">
              <td class="py-2 pr-4 text-gray-500">emitter</td>
              <td class="py-2 font-mono break-all text-gray-200" data-testid="result-emitter">
                {decodedVowResult.decodedEvent.emitter}
              </td>
            </tr>
            <tr class="border-b border-gray-800">
              <td class="py-2 pr-4 align-top text-gray-500">topics</td>
              <td class="py-2 text-gray-200" data-testid="result-topics">
                {#each decodedVowResult.decodedEvent.topics as topic, i (topic)}
                  <div class="break-all">[{i}] {topic}</div>
                {/each}
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 align-top text-gray-500">data</td>
              <td class="py-2 break-all text-gray-200" data-testid="result-data">
                {decodedVowResult.decodedEvent.data}
              </td>
            </tr>
          {:else}
            <tr class="border-b border-gray-800">
              <td class="py-2 pr-4 text-gray-500">programId</td>
              <td class="py-2 break-all text-gray-200" data-testid="result-programId">
                {decodedVowResult.decodedEvent.programId}
              </td>
            </tr>
            <tr class="border-b border-gray-800">
              <td class="py-2 pr-4 text-gray-500">discriminator</td>
              <td class="py-2 break-all text-gray-200" data-testid="result-discriminator">
                {decodedVowResult.decodedEvent.discriminator}
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 align-top text-gray-500">data</td>
              <td class="py-2 break-all text-gray-200" data-testid="result-data">
                {decodedVowResult.decodedEvent.data}
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</main>
