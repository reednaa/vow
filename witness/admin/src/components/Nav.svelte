<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { location } from "svelte-spa-router";

  const dispatch = createEventDispatcher();

  function isActive(path: string) {
    if (path === "/") return $location === "/";
    return $location.startsWith(path);
  }
</script>

<nav>
  <div class="brand">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z"
        fill="var(--accent)" opacity=".9"/>
    </svg>
    <span>Vow Witness</span>
  </div>

  <ul>
    <li>
      <a href="#/" class:active={isActive("/") && $location === "/"}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        Dashboard
      </a>
    </li>
    <li>
      <a href="#/jobs" class:active={isActive("/jobs")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        Jobs
      </a>
    </li>
    <li>
      <a href="#/keys" class:active={isActive("/keys")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
        </svg>
        API Keys
      </a>
    </li>
  </ul>

  <div class="bottom">
    <button class="logout" on:click={() => dispatch("logout")}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      Logout
    </button>
  </div>
</nav>

<style>
  nav {
    width: var(--sidebar-width);
    min-height: 100vh;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 20px 12px;
    flex-shrink: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 15px;
    padding: 4px 8px 20px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
  }
  ul {
    list-style: none;
    flex: 1;
  }
  a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 6px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 14px;
    transition: background 0.1s, color 0.1s;
  }
  a:hover { background: var(--surface-2); color: var(--text); }
  a.active { background: rgba(99,102,241,.15); color: var(--accent-hover); }
  .bottom {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .logout {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    background: transparent;
    color: var(--text-muted);
    border-radius: 6px;
    font-size: 14px;
    text-align: left;
  }
  .logout:hover { background: var(--surface-2); color: var(--text); }
</style>
