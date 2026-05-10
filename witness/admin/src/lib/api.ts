export interface Chain {
  chainId: string;
  latestBlock: string | null;
  updatedAt: string;
  rpcCount: number;
}

export interface Rpc {
  id: number;
  chainId: string;
  url: string;
}

export interface Stats {
  chains: number;
  rpcs: number;
  indexedBlocks: number;
  indexedEvents: number;
  jobs: { pending: number; running: number; failed: number };
}

export interface Job {
  id: string;
  key: string;
  task: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedAt: string | null;
  runAt: string;
  createdAt: string;
  status: "pending" | "running" | "failed" | "scheduled";
}

export interface Block {
  blockNumber: string;
  blockHash: string;
  merkleRoot: string;
  latestBlockAtIndex: string;
  createdAt: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });

  if (res.status === 401) {
    throw new ApiError("Unauthorized", 401);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as any).error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export const api = {
  isUnauthorized: (e: unknown) => e instanceof ApiError && e.status === 401,

  login: (password: string) =>
    req("/admin/auth/login", { method: "POST", body: JSON.stringify({ password }) }),

  logout: () => req("/admin/auth/logout", { method: "POST" }),

  me: () => req<{ ok: boolean }>("/admin/api/me"),

  getStats: () => req<Stats>("/admin/api/stats"),

  getChains: () => req<Chain[]>("/admin/api/chains"),
  addChain: (chainId: string) =>
    req("/admin/api/chains", { method: "POST", body: JSON.stringify({ chainId }) }),
  deleteChain: (chainId: string) =>
    req(`/admin/api/chains/${chainId}`, { method: "DELETE" }),

  getRpcs: (chainId: string) => req<Rpc[]>(`/admin/api/chains/${chainId}/rpcs`),
  addRpc: (chainId: string, url: string) =>
    req(`/admin/api/chains/${chainId}/rpcs`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  deleteRpc: (id: number) => req(`/admin/api/rpcs/${id}`, { method: "DELETE" }),

  getBlocks: (chainId: string) => req<Block[]>(`/admin/api/chains/${chainId}/blocks`),

  getJobs: () => req<Job[]>("/admin/api/jobs"),
};
