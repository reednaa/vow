<script lang="ts">
  import { params } from "svelte-spa-router";
  import { api, type ApiKeyUsageDetail } from "../lib/api";

  let detail: ApiKeyUsageDetail | null = null;
  let loading = true;
  let error = "";

  $: keyId = $params?.id ?? null;

  $: if (keyId) {
    const id = parseInt(keyId, 10);
    if (!isNaN(id)) load(id);
  }

  async function load(id: number) {
    error = "";
    loading = true;
    try {
      detail = await api.getKeyUsage(id);
    } catch (e: any) {
      if (api.isUnauthorized(e)) return;
      error = e.message;
    } finally {
      loading = false;
    }
  }

  $: maxTotal = detail
    ? Math.max(1, ...detail.usage.map((r) => r.coldRequests + r.hotRequests + r.statusRequests))
    : 1;

  $: totals = detail
    ? detail.usage.reduce(
        (acc, r) => ({
          cold: acc.cold + r.coldRequests,
          hot: acc.hot + r.hotRequests,
          status: acc.status + r.statusRequests,
        }),
        { cold: 0, hot: 0, status: 0 }
      )
    : { cold: 0, hot: 0, status: 0 };

  function formatDate(iso: string) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
</script>

<div class="page">
  {#if detail}
    <div class="page-title">{detail.key.name} — Usage</div>
  {:else}
    <div class="page-title">Key Usage</div>
  {/if}

  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if detail}
    <div style="margin-bottom: 24px; display: flex; gap: 12px; align-items: center;">
      <span class="mono" style="font-size: 13px; color: var(--text-muted);">{detail.key.keyPrefix}…</span>
      {#if detail.key.isActive}
        <span class="badge badge-running">Active</span>
      {:else}
        <span class="badge badge-failed">Revoked</span>
      {/if}
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Last 30 Days</h2>
      </div>

      {#if detail.usage.length === 0}
        <div class="empty">No usage data yet.</div>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th style="text-align:right;">Cold</th>
              <th style="text-align:right;">Hot</th>
              <th style="text-align:right;">Status</th>
              <th style="text-align:right;">Total</th>
              <th style="width:200px;">Distribution</th>
            </tr>
          </thead>
          <tbody>
            {#each detail.usage as row}
              {@const total = row.coldRequests + row.hotRequests + row.statusRequests}
              <tr>
                <td>{formatDate(row.date)}</td>
                <td style="text-align:right;" class="mono">{row.coldRequests}</td>
                <td style="text-align:right;" class="mono">{row.hotRequests}</td>
                <td style="text-align:right;" class="mono">{row.statusRequests}</td>
                <td style="text-align:right;font-weight:600;" class="mono">{total}</td>
                <td>
                  <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px;">
                    {#if row.coldRequests > 0}
                      <div style="width:{(row.coldRequests / maxTotal) * 100}%;background:var(--warning);" title="Cold: {row.coldRequests}"></div>
                    {/if}
                    {#if row.hotRequests > 0}
                      <div style="width:{(row.hotRequests / maxTotal) * 100}%;background:var(--accent);" title="Hot: {row.hotRequests}"></div>
                    {/if}
                    {#if row.statusRequests > 0}
                      <div style="width:{(row.statusRequests / maxTotal) * 100}%;background:var(--text-muted);" title="Status: {row.statusRequests}"></div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Summary -->
    <div class="stat-grid" style="margin-top: 24px;">
      <div class="stat-card">
        <div class="label">Cold (not indexed)</div>
        <div class="value" style="color: var(--warning)">{totals.cold}</div>
      </div>
      <div class="stat-card">
        <div class="label">Hot (already indexed)</div>
        <div class="value" style="color: var(--accent-hover)">{totals.hot}</div>
      </div>
      <div class="stat-card">
        <div class="label">Status (checks)</div>
        <div class="value" style="color: var(--text-muted)">{totals.status}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Requests</div>
        <div class="value">{totals.cold + totals.hot + totals.status}</div>
      </div>
    </div>
  {:else if !error}
    <div class="empty">Key not found.</div>
  {/if}
</div>
