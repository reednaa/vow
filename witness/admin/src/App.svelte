<script lang="ts">
  import { onMount } from "svelte";
  import Router, { push } from "svelte-spa-router";
  import { api } from "./lib/api";
  import Login from "./pages/Login.svelte";
  import Dashboard from "./pages/Dashboard.svelte";
  import ChainDetail from "./pages/ChainDetail.svelte";
  import Jobs from "./pages/Jobs.svelte";
  import ApiKeys from "./pages/ApiKeys.svelte";
  import ApiKeyUsage from "./pages/ApiKeyUsage.svelte";
  import Nav from "./components/Nav.svelte";

  let loading = true;
  let loggedIn = false;

  const routes = {
    "/": Dashboard,
    "/chains/:id": ChainDetail,
    "/jobs": Jobs,
    "/keys": ApiKeys,
    "/keys/:id": ApiKeyUsage,
    "*": Dashboard,
  };

  onMount(async () => {
    try {
      await api.me();
      loggedIn = true;
    } catch {
      loggedIn = false;
    }
    loading = false;
  });

  function onLogin() {
    loggedIn = true;
    push("/");
  }

  async function onLogout() {
    try {
      await api.logout();
    } catch {}
    loggedIn = false;
  }

  // Redirect 401 from any page back to login
  function handleConditionFailed(e: CustomEvent) {
    loggedIn = false;
  }
</script>

{#if loading}
  <div class="splash">
    <div class="spinner"></div>
  </div>
{:else if !loggedIn}
  <Login on:login={onLogin} />
{:else}
  <div class="layout">
    <Nav on:logout={onLogout} />
    <main>
      <Router {routes} on:conditionsFailed={handleConditionFailed} />
    </main>
  </div>
{/if}

<style>
  .layout {
    display: flex;
    min-height: 100vh;
  }
  main {
    flex: 1;
    overflow: auto;
  }
  .splash {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
