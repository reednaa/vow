<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Job } from "../lib/api";

  let jobs: Job[] = [];
  let loading = true;
  let error = "";
  let autoRefresh = false;
  let interval: ReturnType<typeof setInterval>;

  onMount(() => {
    load();
    return () => clearInterval(interval);
  });

  $: if (autoRefresh) {
    interval = setInterval(load, 5000);
  } else {
    clearInterval(interval);
  }

  async function load() {
    error = "";
    try {
      jobs = await api.getJobs();
    } catch (e: any) {
      if (api.isUnauthorized(e)) return;
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function statusClass(status: Job["status"]) {
    return `badge badge-${status}`;
  }

  function relativeTime(iso: string) {
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

  let expanded: string | null = null;

  async function requeue(job: Job) {
    try {
      await api.requeueJob(job.id);
      await load();
    } catch (e: any) {
      error = e.message;
    }
  }
</script>

<div class="page">
  <div class="page-title">Job Queue</div>

  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  <div class="card">
    <div class="card-header">
      <h2>Recent Jobs <span style="color:var(--text-muted);font-weight:400;font-size:13px;">(last 100)</span></h2>
      <div style="display:flex;align-items:center;gap:12px;">
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-muted);font-size:13px;cursor:pointer;">
          <input type="checkbox" bind:checked={autoRefresh} style="width:auto;" />
          Auto-refresh (5s)
        </label>
        <button class="btn-ghost" style="font-size:12px;padding:5px 10px;" on:click={load}>
          Refresh
        </button>
      </div>
    </div>

    {#if loading}
      <div class="empty">Loading…</div>
    {:else if jobs.length === 0}
      <div class="empty">No jobs in queue.</div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Key</th>
            <th>Attempts</th>
            <th>Created</th>
            <th>Last Error</th>
          </tr>
        </thead>
        <tbody>
          {#each jobs as job}
            <tr
              style="cursor:pointer;"
              on:click={() => expanded = expanded === job.id ? null : job.id}
            >
              <td><span class={statusClass(job.status)}>{job.status}</span></td>
              <td class="mono">{job.key ?? job.task}</td>
              <td style="color:var(--text-muted);">{job.attempts}/{job.maxAttempts}</td>
              <td style="color:var(--text-muted);">{relativeTime(job.createdAt)}</td>
              <td>
                {#if job.lastError}
                  <span style="color:var(--danger);font-size:12px;" title={job.lastError}>
                    {job.lastError.slice(0, 60)}{job.lastError.length > 60 ? "…" : ""}
                  </span>
                {:else}
                  <span style="color:var(--text-muted);">—</span>
                {/if}
              </td>
            </tr>
            {#if expanded === job.id}
              <tr>
                <td colspan="5" style="background:var(--surface-2);padding:16px;">
                  <div style="display:grid;gap:8px;">
                    <div><span style="color:var(--text-muted);">Task: </span>{job.task}</div>
                    <div>
                      <span style="color:var(--text-muted);">Payload: </span>
                      <code class="mono">{JSON.stringify(job.payload, null, 2)}</code>
                    </div>
                    {#if job.lastError}
                      <div>
                        <span style="color:var(--text-muted);">Full error: </span>
                        <pre class="mono" style="white-space:pre-wrap;color:var(--danger);">{job.lastError}</pre>
                      </div>
                    {/if}
                    {#if job.lockedAt}
                      <div><span style="color:var(--text-muted);">Locked at: </span>{relativeTime(job.lockedAt)}</div>
                    {/if}
                    {#if job.status === "running" || job.status === "failed"}
                      <div style="margin-top:8px;">
                        <button
                          class="btn-ghost"
                          style="font-size:12px;padding:5px 10px;"
                          on:click|stopPropagation={() => requeue(job)}
                        >
                          Re-queue
                        </button>
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
