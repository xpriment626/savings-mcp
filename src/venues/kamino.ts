import { CANONICAL_SOLANA_USDC_MINT, USDC_ASSET } from '../constants.js';
import { attachOpportunityDisplay } from '../core/display.js';
import { fixtureCatalogue } from '../fixtures.js';
import type { AppConfig, ProductType, RiskTier, SavingsCatalogue, SavingsOpportunity } from '../types.js';
import type { VenueAdapter } from './types.js';

const LEND_MIN_TVL_USD = 1_000_000;
const EARN_MIN_AUM_USD = 50_000;
const SANE_APY_MAX = 0.5;

let cache: { at: number; data: SavingsCatalogue } | null = null;

interface KaminoMarket {
  lendingMarket: string;
  name: string;
  isPrimary?: boolean;
}

interface KaminoReserve {
  reserve: string;
  liquidityTokenMint?: string;
  totalSupplyUsd?: unknown;
  totalBorrowUsd?: unknown;
  supplyApy?: unknown;
}

interface KaminoVault {
  address: string;
  state?: {
    tokenMint?: string;
    name?: string;
  };
}

interface KaminoVaultMetrics {
  apy?: unknown;
  apy30d?: unknown;
  tokensInvestedUsd?: unknown;
  tokensAvailableUsd?: unknown;
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs: number): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`Kamino ${path} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      if (item !== undefined) out[current] = await fn(item);
    }
  });
  await Promise.all(workers);
  return out;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function riskTierForLend(isPrimary: boolean, tvlUsd: number, utilizationPct: number): RiskTier {
  if (isPrimary) return 'conservative';
  if (tvlUsd >= 20_000_000 && utilizationPct <= 96) return 'moderate';
  if (tvlUsd >= 5_000_000) return 'elevated';
  return 'high';
}

function scoreForTier(tier: RiskTier, utilizationPct = 0, productType: ProductType = 'lending_reserve'): number {
  const base = { conservative: 18, moderate: 36, elevated: 58, high: 78 }[tier];
  const utilizationPenalty = utilizationPct > 90 ? 8 : utilizationPct > 80 ? 4 : 0;
  const complexityPenalty = productType === 'vault' ? 6 : 0;
  return Math.min(100, base + utilizationPenalty + complexityPenalty);
}

function normalizeLendReserve({
  market,
  reserve,
  generatedAt
}: {
  market: KaminoMarket;
  reserve: KaminoReserve;
  generatedAt: string;
}): SavingsOpportunity | null {
  const tvlUsd = Number(reserve.totalSupplyUsd) || 0;
  if (reserve.liquidityTokenMint !== CANONICAL_SOLANA_USDC_MINT || tvlUsd < LEND_MIN_TVL_USD) return null;

  const borrowUsd = Number(reserve.totalBorrowUsd) || 0;
  const utilizationPct = tvlUsd > 0 ? (borrowUsd / tvlUsd) * 100 : 0;
  const isPrimary = Boolean(market.isPrimary) || /^main market$/i.test(market.name);
  const tier = riskTierForLend(isPrimary, tvlUsd, utilizationPct);
  const withdrawalBufferPct = Math.max(0, 100 - utilizationPct);

  return attachOpportunityDisplay({
    id: `kamino:lend:${reserve.reserve}`,
    venue: 'Kamino',
    protocol: 'kamino',
    product_type: 'lending_reserve',
    title: `USDC - ${market.name}`,
    asset: USDC_ASSET,
    apy: {
      current: Number(reserve.supplyApy) || 0,
      source: 'kamino.reserve.metrics',
      window: 'current_supply_apy'
    },
    tvl: { usd: tvlUsd },
    liquidity: {
      utilizationPct: Math.round(utilizationPct * 100) / 100,
      withdrawalBufferPct: Math.round(withdrawalBufferPct * 100) / 100
    },
    risk: {
      tier,
      score: scoreForTier(tier, utilizationPct),
      factors: [
        isPrimary ? 'main-market reserve' : 'isolated-market reserve',
        utilizationPct > 90 ? 'high utilization' : 'normal utilization',
        'simple lending reserve'
      ],
      synthesis: `${isPrimary ? 'Main-market' : 'Isolated-market'} USDC lending reserve with ${Math.round(
        utilizationPct
      )}% utilization and ${Math.round(withdrawalBufferPct)}% idle withdrawal buffer.`
    },
    flags: {
      depositable: isPrimary,
      simulatable: isPrimary
    },
    refs: {
      market: market.lendingMarket,
      reserve: reserve.reserve,
      assetMint: reserve.liquidityTokenMint
    },
    evidence: [
      {
        label: 'Kamino reserve metrics',
        url: `https://api.kamino.finance/kamino-market/${market.lendingMarket}/reserves/metrics`,
        observedAt: generatedAt
      }
    ],
    generated_at: generatedAt
  });
}

function normalizeVault({
  vault,
  metrics,
  generatedAt
}: {
  vault: KaminoVault;
  metrics: KaminoVaultMetrics;
  generatedAt: string;
}): SavingsOpportunity | null {
  const tokenMint = vault.state?.tokenMint;
  if (tokenMint !== CANONICAL_SOLANA_USDC_MINT) return null;

  const apy = Number(metrics.apy30d) || Number(metrics.apy) || 0;
  if (apy <= 0 || apy > SANE_APY_MAX) return null;

  const tvlUsd = (Number(metrics.tokensInvestedUsd) || 0) + (Number(metrics.tokensAvailableUsd) || 0);
  if (tvlUsd < EARN_MIN_AUM_USD) return null;

  const tier: RiskTier = tvlUsd >= 1_000_000 ? 'moderate' : 'elevated';
  const name = vault.state?.name?.trim() || 'USDC Earn Vault';

  return attachOpportunityDisplay({
    id: `kamino:earn:${vault.address}`,
    venue: 'Kamino',
    protocol: 'kamino',
    product_type: 'vault',
    title: name,
    asset: USDC_ASSET,
    apy: {
      current: apy,
      source: 'kamino.vault.metrics',
      window: Number(metrics.apy30d) ? '30d' : 'current'
    },
    tvl: { usd: tvlUsd },
    liquidity: { utilizationPct: null, withdrawalBufferPct: null },
    risk: {
      tier,
      score: scoreForTier(tier, 0, 'vault'),
      factors: ['managed vault', 'curator dependency', 'underlying reserve exposure'],
      synthesis:
        'Managed USDC vault; expected return and exit behavior depend on the curator and the underlying Kamino reserve allocations.'
    },
    flags: { depositable: false, simulatable: false },
    refs: { vault: vault.address, assetMint: tokenMint },
    evidence: [
      {
        label: 'Kamino vault metrics',
        url: `https://api.kamino.finance/kvaults/vaults/${vault.address}/metrics`,
        observedAt: generatedAt
      }
    ],
    generated_at: generatedAt
  });
}

async function buildLiveCatalogue(config: AppConfig, generatedAt: string): Promise<SavingsCatalogue> {
  const markets = asArray<KaminoMarket>(await getJson<unknown>(config.kaminoApiBaseUrl, '/v2/kamino-market', config.requestTimeoutMs));
  const lendResults = await mapLimit(markets, 8, async (market) => {
    try {
      const reserves = asArray<KaminoReserve>(
        await getJson<unknown>(
          config.kaminoApiBaseUrl,
          `/kamino-market/${market.lendingMarket}/reserves/metrics`,
          config.requestTimeoutMs
        )
      );
      return reserves.map((reserve) => normalizeLendReserve({ market, reserve, generatedAt })).filter(isPresent);
    } catch {
      return [];
    }
  });

  const vaults = asArray<KaminoVault>(
    await getJson<unknown>(config.kaminoApiBaseUrl, '/kvaults/vaults', config.requestTimeoutMs).catch(() => [])
  );
  const usdcVaults = vaults.filter((vault) => vault.state?.tokenMint === CANONICAL_SOLANA_USDC_MINT);
  const vaultResults = await mapLimit(usdcVaults, 8, async (vault) => {
    try {
      const metrics = (await getJson<unknown>(
        config.kaminoApiBaseUrl,
        `/kvaults/vaults/${vault.address}/metrics`,
        config.requestTimeoutMs
      )) as KaminoVaultMetrics;
      return normalizeVault({ vault, metrics, generatedAt });
    } catch {
      return null;
    }
  });

  const opportunities = [...lendResults.flat(), ...vaultResults.filter(isPresent)].sort(
    (a, b) => a.risk.score - b.risk.score || b.tvl.usd - a.tvl.usd
  );

  return {
    asset: USDC_ASSET,
    generated_at: generatedAt,
    source: {
      venue: 'Kamino',
      mode: 'live',
      baseUrl: config.kaminoApiBaseUrl
    },
    opportunities
  };
}

export function createKaminoVenueAdapter(config: Partial<AppConfig> & Pick<AppConfig, 'useFixtureCatalogue'>): VenueAdapter {
  const adapterConfig = config as AppConfig;

  return {
    id: 'kamino',
    name: 'Kamino',
    async listUsdcOpportunities(options = {}) {
      const now = Date.now();
      const generatedAt = new Date(now).toISOString();
      if (adapterConfig.useFixtureCatalogue) return fixtureCatalogue(generatedAt);

      if (!options.refresh && cache && now - cache.at < adapterConfig.cacheTtlMs) return cache.data;

      const data = await buildLiveCatalogue(adapterConfig, generatedAt);
      cache = { at: now, data };
      return data;
    }
  };
}
