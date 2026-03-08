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

function parsePrivateKey(raw: string): `0x${string}` {
  const stripped = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!HEX_64_RE.test(stripped)) {
    throw new Error("WITNESS_PRIVATE_KEY must be a 32-byte hex-encoded private key");
  }
  return `0x${stripped}`;
}

export interface Config {
  witnessPrivateKey: `0x${string}`;
  databaseUrl: string;
  apiPort: number;
  healthPort: number;
}

export function loadConfig(): Config {
  return {
    witnessPrivateKey: parsePrivateKey(requireEnv("WITNESS_PRIVATE_KEY")),
    databaseUrl: requireEnv("DATABASE_URL"),
    apiPort: parsePort("API_PORT", 3000),
    healthPort: parsePort("HEALTH_PORT", 3001),
  };
}
