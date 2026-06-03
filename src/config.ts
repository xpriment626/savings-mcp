import type { AppConfig } from './types.js';

const DEFAULT_PORT = 8788;

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const heliusRpcUrl = env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
    : undefined;

  return {
    host: env.HOST ?? '127.0.0.1',
    port: parseInteger(env.PORT, DEFAULT_PORT),
    kaminoApiBaseUrl: env.KAMINO_API_BASE_URL ?? 'https://api.kamino.finance',
    requestTimeoutMs: parseInteger(env.KAMINO_REQUEST_TIMEOUT_MS, 10_000),
    cacheTtlMs: parseInteger(env.SAVINGS_CACHE_TTL_MS, 10 * 60 * 1000),
    useFixtureCatalogue: parseBoolean(env.SAVINGS_USE_FIXTURE_CATALOGUE, false),
    solanaRpcUrl: env.SOLANA_RPC_URL || heliusRpcUrl || '',
    openrouterApiKey: env.OPENROUTER_API_KEY ?? '',
    exaApiKey: env.EXA_API_KEY ?? ''
  };
}
