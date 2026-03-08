function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parsePort(name: string, defaultPort: number): number {
  const raw = process.env[name];
  if (!raw) return defaultPort;
  const port = parseInt(raw, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in ${name}: ${raw}`);
  }
  return port;
}

const HEX_64_RE = /^[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function parsePrivateKey(raw: string): `0x${string}` {
  const stripped = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!HEX_64_RE.test(stripped)) {
    throw new Error("WITNESS_PRIVATE_KEY must be a 32-byte hex-encoded private key");
  }
  return `0x${stripped}`;
}

function parseAddress(name: string, raw: string): `0x${string}` {
  if (!ADDRESS_RE.test(raw)) {
    throw new Error(`${name} must be a 20-byte hex-encoded address`);
  }
  return raw as `0x${string}`;
}

export interface CombinedConfig {
  witnessPrivateKey: `0x${string}`;
  databaseUrl: string;
  apiPort: number;
  healthPort: number;
}

export interface ApiConfig {
  witnessSignerAddress: `0x${string}`;
  databaseUrl: string;
  apiPort: number;
  healthPort: number;
}

export interface WorkerConfig {
  witnessPrivateKey: `0x${string}`;
  databaseUrl: string;
  workerHealthPort: number;
}

export interface MigrateConfig {
  databaseUrl: string;
}

export function loadCombinedConfig(): CombinedConfig {
  return {
    witnessPrivateKey: parsePrivateKey(requireEnv("WITNESS_PRIVATE_KEY")),
    databaseUrl: requireEnv("DATABASE_URL"),
    apiPort: parsePort("API_PORT", 3000),
    healthPort: parsePort("HEALTH_PORT", 3001),
  };
}

export function loadApiConfig(): ApiConfig {
  return {
    witnessSignerAddress: parseAddress(
      "WITNESS_SIGNER_ADDRESS",
      requireEnv("WITNESS_SIGNER_ADDRESS")
    ),
    databaseUrl: requireEnv("DATABASE_URL"),
    apiPort: parsePort("API_PORT", 3000),
    healthPort: parsePort("HEALTH_PORT", 3001),
  };
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    witnessPrivateKey: parsePrivateKey(requireEnv("WITNESS_PRIVATE_KEY")),
    databaseUrl: requireEnv("DATABASE_URL"),
    workerHealthPort: parsePort("WORKER_HEALTH_PORT", 3002),
  };
}

export function loadMigrateConfig(): MigrateConfig {
  return { databaseUrl: requireEnv("DATABASE_URL") };
}

export const loadConfig = loadCombinedConfig;
