<script lang="ts">
  import { onMount } from "svelte";
  import { push } from "svelte-spa-router";
  import { api, type Chain, type Stats } from "../lib/api";

  let stats: Stats | null = null;
  let chains: Chain[] = [];
  let loading = true;
  let error = "";

  // Add chain form
  let newChainId = "";
  let addingChain = false;
  let addError = "";
  let addSuccess = "";

  onMount(load);

  async function load() {
    loading = true;
    error = "";
    try {
      [stats, chains] = await Promise.all([api.getStats(), api.getChains()]);
    } catch (e: any) {
      if (api.isUnauthorized(e)) return;
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function addChain() {
    if (!newChainId) return;
    addingChain = true;
    addError = "";
    addSuccess = "";
    try {
      await api.addChain(newChainId);
      addSuccess = `Chain ${newChainId} added`;
      newChainId = "";
      await load();
    } catch (e: any) {
      addError = e.message;
    } finally {
      addingChain = false;
    }
  }

  async function deleteChain(chainId: string) {
    if (!confirm(`Delete chain ${chainId} and all its data? This cannot be undone.`)) return;
    try {
      await api.deleteChain(chainId);
      await load();
    } catch (e: any) {
      error = e.message;
    }
  }
</script>

<div class="page">
  <div class="page-title">Dashboard</div>

  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if stats}
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Chains</div>
        <div class="value">{stats.chains}</div>
      </div>
      <div class="stat-card">
        <div class="label">RPCs</div>
        <div class="value">{stats.rpcs}</div>
      </div>
      <div class="stat-card">
        <div class="label">Indexed Blocks</div>
        <div class="value">{stats.indexedBlocks.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="label">Indexed Events</div>
        <div class="value">{stats.indexedEvents.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="label">Jobs Pending</div>
        <div class="value" style="color: var(--warning)">{stats.jobs.pending}</div>
      </div>
      <div class="stat-card">
        <div class="label">Jobs Running</div>
        <div class="value" style="color: var(--accent-hover)">{stats.jobs.running}</div>
      </div>
      <div class="stat-card">
        <div class="label">Jobs Failed</div>
        <div class="value" style="color: {stats.jobs.failed > 0 ? 'var(--danger)' : 'inherit'}">{stats.jobs.failed}</div>
      </div>
    </div>
  {/if}

  <!-- Add chain -->
  <div class="card" style="margin-bottom: 24px;">
    <div class="card-header">
      <h2>Add Chain</h2>
    </div>
    <div style="padding: 16px 20px;">
      {#if addError}<div class="alert alert-error">{addError}</div>{/if}
      {#if addSuccess}<div class="alert alert-success">{addSuccess}</div>{/if}
      <div class="form-row">
        <input
          type="text"
          placeholder="CAIP-2 chain ID (e.g. eip155:1 for Ethereum, solana:mainnet)"
          bind:value={newChainId}
          on:keydown={(e) => e.key === "Enter" && addChain()}
          style="max-width: 480px;"
        />
        <button class="btn-primary" on:click={addChain} disabled={addingChain || !newChainId}>
          {addingChain ? "Adding…" : "Add Chain"}
        </button>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">
        Enter a CAIP-2 identifier: <code>eip155:&lt;chainId&gt;</code> for EVM chains, <code>solana:&lt;cluster&gt;</code> for Solana.
      </p>
    </div>
  </div>

  <!-- Chains list -->
  <div class="card">
    <div class="card-header">
      <h2>Configured Chains</h2>
      <button class="btn-ghost" style="font-size:12px; padding:5px 10px;" on:click={load}>
        Refresh
      </button>
    </div>
    {#if !loading && chains.length === 0}
      <div class="empty">No chains configured yet.</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Chain ID</th>
            <th>Latest Indexed Block</th>
            <th>RPCs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each chains as chain}
            <tr>
              <td>
                <a href={`#/chains/${chain.chainId}`} style="font-weight:600;">
                  {chain.chainId}
                </a>
              </td>
              <td class="mono">{chain.latestBlock ?? "—"}</td>
              <td>
                <span style="color: {chain.rpcCount < 2 ? 'var(--warning)' : 'inherit'}">
                  {chain.rpcCount}
                  {#if chain.rpcCount < 2}
                    <span title="Need at least 2 RPCs" style="font-size:11px;"> ⚠</span>
                  {/if}
                </span>
              </td>
              <td style="text-align:right;">
                <button class="btn-ghost" style="font-size:12px;padding:5px 10px;margin-right:6px;"
                  on:click={() => push(`/chains/${chain.chainId}`)}>
                  Manage
                </button>
                <button class="btn-danger" on:click={() => deleteChain(chain.chainId)}>
                  Delete
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
