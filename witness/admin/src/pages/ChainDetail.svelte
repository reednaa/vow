<script lang="ts">
  import { onMount } from "svelte";
  import { push } from "svelte-spa-router";
  import { api, type Chain, type Rpc, type Block } from "../lib/api";

  export let params: { id: string } = { id: "" };

  const chainId: string = params.id;

  let chain: Chain | null = null;
  let rpcs: Rpc[] = [];
  let blocks: Block[] = [];
  let loading = true;
  let error = "";

  $: isSolana = chainId.startsWith("solana:");

  let newRpcUrl = "";
  let addingRpc = false;
  let addError = "";
  let addSuccess = "";

  let confirmationsValue = 12;
  let updatingConfig = false;
  let configError = "";
  let configSuccess = "";

  onMount(load);

  async function load() {
    loading = true;
    error = "";
    try {
      const [chains, rpcList, blockList] = await Promise.all([
        api.getChains(),
        api.getRpcs(chainId),
        api.getBlocks(chainId),
      ]);
      chain = chains.find((c) => c.chainId === chainId) ?? null;
      if (!chain) {
        error = `Chain ${chainId} not found`;
      } else {
        confirmationsValue = chain.confirmations;
      }
      rpcs = rpcList;
      blocks = blockList;
    } catch (e: any) {
      if (api.isUnauthorized(e)) return;
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function addRpc() {
    if (!newRpcUrl || addingRpc) return;
    addingRpc = true;
    addError = "";
    addSuccess = "";
    try {
      const res: any = await api.addRpc(chainId, newRpcUrl);
      addSuccess = `RPC added (current height: ${res.blockNumber})`;
      newRpcUrl = "";
      rpcs = await api.getRpcs(chainId);
    } catch (e: any) {
      addError = e.message;
    } finally {
      addingRpc = false;
    }
  }

  async function deleteRpc(id: number, url: string) {
    if (!confirm(`Remove RPC ${url}?`)) return;
    try {
      await api.deleteRpc(id);
      rpcs = rpcs.filter((r) => r.id !== id);
    } catch (e: any) {
      error = e.message;
    }
  }

  async function updateConfirmations() {
    if (updatingConfig) return;
    updatingConfig = true;
    configError = "";
    configSuccess = "";
    try {
      await api.updateChainConfirmations(chainId, confirmationsValue);
      configSuccess = `Confirmations updated to ${confirmationsValue}`;
      if (chain) chain.confirmations = confirmationsValue;
    } catch (e: any) {
      configError = e.message;
    } finally {
      updatingConfig = false;
    }
  }

  function truncate(hex: string, chars = 10) {
    if (!hex) return "—";
    return hex.slice(0, chars + 2) + "…" + hex.slice(-4);
  }

  function relativeTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
</script>

<div class="page">
  <div class="page-title">
    <button class="btn-ghost" style="padding:4px 8px;font-size:13px;" on:click={() => push("/")}>
      ← Back
    </button>
    Chain {chainId}
  </div>

  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  {#if !loading && chain}
    <div class="stat-grid" style="margin-bottom: 24px;">
      <div class="stat-card">
        <div class="label">{isSolana ? "Latest Indexed Slot" : "Latest Indexed Block"}</div>
        <div class="value mono" style="font-size:18px;">{chain.latestBlock ?? "—"}</div>
      </div>
      <div class="stat-card">
        <div class="label">RPC Endpoints</div>
        <div class="value" style="color: {rpcs.length < 2 ? 'var(--warning)' : 'inherit'}">{rpcs.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">{isSolana ? "Recent Indexed Slots" : "Recent Indexed Blocks"}</div>
        <div class="value">{blocks.length}</div>
      </div>
    </div>
  {/if}

  <!-- Chain Configuration -->
  <div class="card" style="margin-bottom: 24px;">
    <div class="card-header">
      <h2>Chain Configuration</h2>
    </div>
    <div style="padding: 16px 20px;">
      {#if configError}<div class="alert alert-error">{configError}</div>{/if}
      {#if configSuccess}<div class="alert alert-success">{configSuccess}</div>{/if}
      <div class="form-row">
        <label style="display:flex;align-items:center;gap:8px;">
          <span>Confirmations required:</span>
          <input
            type="number"
            min="0"
            bind:value={confirmationsValue}
            style="width:80px;"
          />
          <button
            class="btn-primary"
            on:click={updateConfirmations}
            disabled={updatingConfig || confirmationsValue === chain?.confirmations}
          >
            {updatingConfig ? "Saving…" : "Update"}
          </button>
        </label>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">
        Number of {isSolana ? "slots" : "blocks"} that must be built on top before the service signs an attestation. Set to 0 for immediate signing.
      </p>
    </div>
  </div>

  <!-- RPCs -->
  <div class="card" style="margin-bottom: 24px;">
    <div class="card-header">
      <h2>RPC Endpoints</h2>
    </div>
    <div style="padding: 16px 20px; border-bottom: 1px solid var(--border);">
      {#if rpcs.length < 2}
        <div class="alert alert-error" style="margin-bottom:12px;">
          ⚠ At least 2 RPCs are required for witness indexing.
        </div>
      {/if}
      {#if addError}<div class="alert alert-error">{addError}</div>{/if}
      {#if addSuccess}<div class="alert alert-success">{addSuccess}</div>{/if}
      <div class="form-row">
        <input
          type="url"
          placeholder="https://mainnet.infura.io/v3/YOUR_KEY"
          bind:value={newRpcUrl}
          on:keydown={(e) => e.key === "Enter" && addRpc()}
        />
        <button class="btn-primary" on:click={addRpc} disabled={addingRpc || !newRpcUrl}>
          {addingRpc ? "Validating…" : "Add RPC"}
        </button>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">
        URL will be validated with the chain's native RPC method before saving.
      </p>
    </div>
    {#if rpcs.length === 0}
      <div class="empty">No RPCs configured.</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each rpcs as rpc}
            <tr>
              <td class="mono" style="word-break:break-all;">{rpc.url}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn-danger" on:click={() => deleteRpc(rpc.id, rpc.url)}>
                  Remove
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <!-- Recent blocks -->
  <div class="card">
    <div class="card-header">
      <h2>{isSolana ? "Recent Indexed Slots" : "Recent Indexed Blocks"}</h2>
      <button class="btn-ghost" style="font-size:12px;padding:5px 10px;" on:click={load}>
        Refresh
      </button>
    </div>
    {#if loading}
      <div class="empty">Loading…</div>
    {:else if blocks.length === 0}
      <div class="empty">No indexed {isSolana ? "slots" : "blocks"} yet.</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>{isSolana ? "Slot" : "Block"}</th>
            <th>{isSolana ? "Blockhash" : "Block Hash"}</th>
            <th>Merkle Root</th>
            <th>Indexed At</th>
          </tr>
        </thead>
        <tbody>
          {#each blocks as block}
            <tr>
              <td class="mono">{block.blockNumber}</td>
              <td class="mono" title={block.blockHash}>{truncate(block.blockHash)}</td>
              <td class="mono" title={block.merkleRoot}>{truncate(block.merkleRoot)}</td>
              <td style="color:var(--text-muted);">{relativeTime(block.createdAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
