<script lang="ts">
  import { onMount } from "svelte";
  import { push } from "svelte-spa-router";
  import { api, type ApiKey, type ApiKeyCreateResult } from "../lib/api";

  let keys: ApiKey[] = [];
  let loading = true;
  let error = "";

  let newKeyName = "";
  let creating = false;
  let createError = "";
  let createdKey: ApiKeyCreateResult | null = null;

  onMount(load);

  async function load() {
    error = "";
    loading = true;
    try {
      keys = await api.getKeys();
    } catch (e: any) {
      if (api.isUnauthorized(e)) return;
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function createKey() {
    if (!newKeyName.trim()) return;
    creating = true;
    createError = "";
    createdKey = null;
    try {
      createdKey = await api.createKey(newKeyName.trim());
      newKeyName = "";
      await load();
    } catch (e: any) {
      createError = e.message;
    } finally {
      creating = false;
    }
  }

  async function revokeKey(id: number, name: string) {
    if (!confirm(`Revoke API key "${name}"? This cannot be undone.`)) return;
    try {
      await api.revokeKey(id);
      await load();
    } catch (e: any) {
      error = e.message;
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  function relativeTime(iso: string | null) {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  let copied = false;
  function onCopy() {
    if (createdKey) copyToClipboard(createdKey.key);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }
</script>

<div class="page">
  <div class="page-title">API Keys</div>

  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  <!-- Create Key -->
  <div class="card" style="margin-bottom: 24px;">
    <div class="card-header">
      <h2>Create API Key</h2>
    </div>
    <div style="padding: 16px 20px;">
      {#if createError}
        <div class="alert alert-error">{createError}</div>
      {/if}

      {#if createdKey}
        <div class="alert alert-success" style="margin-bottom: 16px;">
          <strong>Key created!</strong> Copy it now — it won't be shown again.
          <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px;">
            <code class="mono" style="flex: 1; padding: 8px; background: var(--surface-2); border-radius: 4px; word-break: break-all;">
              {createdKey.key}
            </code>
            <button class="btn-primary" on:click={onCopy} style="white-space: nowrap;">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      {/if}

      <div class="form-row">
        <input
          type="text"
          placeholder="Key name (e.g., production, staging, alice)"
          bind:value={newKeyName}
          on:keydown={(e) => e.key === "Enter" && createKey()}
          style="max-width: 360px;"
        />
        <button class="btn-primary" on:click={createKey} disabled={creating || !newKeyName.trim()}>
          {creating ? "Creating…" : "Create Key"}
        </button>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">
        Keys use the format <code>vow_wit_</code> + 64 hex chars. Use as <code>Authorization: Bearer &lt;key&gt;</code> header or <code>?api_key=&lt;key&gt;</code> query parameter.
      </p>
    </div>
  </div>

  <!-- Keys List -->
  <div class="card">
    <div class="card-header">
      <h2>Keys</h2>
      <button class="btn-ghost" style="font-size:12px; padding:5px 10px;" on:click={load}>
        Refresh
      </button>
    </div>

    {#if loading}
      <div class="empty">Loading…</div>
    {:else if keys.length === 0}
      <div class="empty">No API keys yet. Create one above.</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Prefix</th>
            <th>Status</th>
            <th>Created</th>
            <th>Last Used</th>
            <th style="text-align:right;">Cold</th>
            <th style="text-align:right;">Hot</th>
            <th style="text-align:right;">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each keys as key}
            <tr>
              <td>
                <a href={`#/keys/${key.id}`} style="font-weight:600;">
                  {key.name}
                </a>
              </td>
              <td class="mono" style="font-size:12px;">{key.keyPrefix}…</td>
              <td>
                {#if key.isActive}
                  <span class="badge badge-running">Active</span>
                {:else}
                  <span class="badge badge-failed">Revoked</span>
                {/if}
              </td>
              <td style="color:var(--text-muted);">{new Date(key.createdAt).toLocaleDateString()}</td>
              <td style="color:var(--text-muted);">{relativeTime(key.lastUsedAt)}</td>
              <td style="text-align:right;" class="mono">{key.todayUsage.cold}</td>
              <td style="text-align:right;" class="mono">{key.todayUsage.hot}</td>
              <td style="text-align:right;" class="mono">{key.todayUsage.status}</td>
              <td style="text-align:right;">
                <button
                  class="btn-ghost" style="font-size:12px;padding:5px 10px;margin-right:6px;"
                  on:click={() => push(`/keys/${key.id}`)}>
                  Usage
                </button>
                {#if key.isActive}
                  <button class="btn-danger" on:click={() => revokeKey(key.id, key.name)}>
                    Revoke
                  </button>
                {:else}
                  <span style="color:var(--text-muted);font-size:12px;">Revoked</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
