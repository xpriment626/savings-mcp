import { CANONICAL_SOLANA_USDC_MINT, USDC_ASSET } from '../constants.js';
import { attachOpportunityDisplay } from '../core/display.js';
import type { AppConfig, RiskTier, SavingsCatalogue, SavingsOpportunity } from '../types.js';
import type { VenueAdapter } from './types.js';

let cache: { at: number; data: SavingsCatalogue } | null = null;

interface SaveMarketConfig {
  name?: unknown;
  address?: unknown;
  isPrimary?: unknown;
  hidden?: unknown;
  reserves?: SaveReserveConfig[];
}

interface SaveReserveConfig {
  address?: unknown;
  collateralMintAddress?: unknown;
  liquidityToken?: {
    mint?: unknown;
    symbol?: unknown;
    decimals?: unknown;
  };
  userSupplyCap?: unknown;
}

interface SaveReserveDetails {
  reserve?: {
    liquidity?: {
      mintPubkey?: unknown;
      mintDecimals?: unknown;
      availableAmount?: unknown;
      borrowedAmountWads?: unknown;
      marketPrice?: unknown;
    };
    collateral?: {
      mintPubkey?: unknown;
      mintTotalSupply?: unknown;
    };
    config?: {
      loanToValueRatio?: unknown;
      liquidationThreshold?: unknown;
      depositLimit?: unknown;
      borrowLimit?: unknown;
    };
    pubkey?: unknown;
  };
  cTokenExchangeRate?: unknown;
  rates?: {
    supplyInterest?: unknown;
    borrowInterest?: unknown;
  };
  rewards?: unknown[];
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs: number): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`Save/Solend ${path} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentToDecimal(value: unknown): number {
  return numberValue(value) / 100;
}

function baseUnitsToUi(value: unknown, decimals = 6): number {
  return numberValue(value) / 10 ** decimals;
}

function wadsToUi(value: unknown, decimals = 6): number {
  return numberValue(value) / 10 ** 18 / 10 ** decimals;
}

function wadPrice(value: unknown): number {
  return numberValue(value) / 10 ** 18 || 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function riskTierForReserve(isPrimary: boolean, tvlUsd: number, utilizationPct: number): RiskTier {
  if (isPrimary && tvlUsd >= 20_000_000 && utilizationPct < 85) return 'conservative';
  if (tvlUsd >= 10_000_000 && utilizationPct < 92) return 'moderate';
  if (tvlUsd >= 2_000_000) return 'elevated';
  return 'high';
}

function scoreForTier(tier: RiskTier, utilizationPct: number): number {
  const base = { conservative: 20, moderate: 34, elevated: 58, high: 78 }[tier];
  const utilizationPenalty = utilizationPct >= 90 ? 8 : utilizationPct >= 80 ? 4 : 0;
  return Math.min(100, base + utilizationPenalty);
}

function normalizeReserve(input: {
  market: SaveMarketConfig;
  configReserve: SaveReserveConfig;
  details: SaveReserveDetails;
  generatedAt: string;
}): SavingsOpportunity | null {
  const mint = input.details.reserve?.liquidity?.mintPubkey ?? input.configReserve.liquidityToken?.mint;
  if (mint !== CANONICAL_SOLANA_USDC_MINT) return null;

  const decimals = numberValue(input.details.reserve?.liquidity?.mintDecimals) || 6;
  const available = baseUnitsToUi(input.details.reserve?.liquidity?.availableAmount, decimals);
  const borrowed = wadsToUi(input.details.reserve?.liquidity?.borrowedAmountWads, decimals);
  const totalSupply = available + borrowed;
  const price = wadPrice(input.details.reserve?.liquidity?.marketPrice);
  const tvlUsd = totalSupply * price;
  const utilizationPct = totalSupply > 0 ? round2((borrowed / totalSupply) * 100) : 0;
  const withdrawalBufferPct = totalSupply > 0 ? round2((available / totalSupply) * 100) : null;
  const isPrimary = Boolean(input.market.isPrimary) || input.market.name === 'main';
  const tier = riskTierForReserve(isPrimary, tvlUsd, utilizationPct);
  const reserveAddress = String(input.configReserve.address ?? input.details.reserve?.pubkey ?? 'main-usdc');
  const marketName = String(input.market.name ?? 'main');

  return attachOpportunityDisplay({
    id: 'save:lend:main-usdc',
    venue: 'Save/Solend',
    protocol: 'save_solend',
    product_type: 'lending_reserve',
    title: `USDC - Save ${marketName}`,
    asset: USDC_ASSET,
    apy: {
      current: percentToDecimal(input.details.rates?.supplyInterest),
      source: 'save.reserve.details',
      window: 'current_supply_interest'
    },
    tvl: { usd: tvlUsd },
    liquidity: {
      utilizationPct,
      withdrawalBufferPct
    },
    risk: {
      tier,
      score: scoreForTier(tier, utilizationPct),
      factors: [
        isPrimary ? 'main Save/Solend market reserve' : 'non-primary Save/Solend market reserve',
        utilizationPct >= 85 ? 'high utilization' : 'normal utilization',
        'classic lending reserve mechanics',
        'reserve deposits can be obligation collateral'
      ],
      synthesis: `Save/Solend USDC reserve with ${Math.round(utilizationPct)}% utilization and ${
        withdrawalBufferPct === null ? 'unknown' : `${Math.round(withdrawalBufferPct)}%`
      } idle withdrawal buffer.`
    },
    flags: {
      depositable: isPrimary,
      simulatable: isPrimary
    },
    refs: {
      market: String(input.market.address ?? 'main'),
      reserve: reserveAddress,
      assetMint: CANONICAL_SOLANA_USDC_MINT
    },
    evidence: [
      {
        label: 'Save market configs',
        url: 'https://api.save.finance/v1/markets/configs?scope=all',
        observedAt: input.generatedAt
      },
      {
        label: 'Save reserve details',
        url: `https://api.save.finance/v1/reserves?ids=${reserveAddress}`,
        observedAt: input.generatedAt
      }
    ],
    generated_at: input.generatedAt
  });
}

function fixtureCatalogue(generatedAt: string): SavingsCatalogue {
  return {
    asset: USDC_ASSET,
    generated_at: generatedAt,
    source: {
      venue: 'Save/Solend',
      mode: 'fixture',
      baseUrl: 'https://api.save.finance/v1'
    },
    opportunities: [
      attachOpportunityDisplay({
        id: 'save:lend:main-usdc',
        venue: 'Save/Solend',
        protocol: 'save_solend',
        product_type: 'lending_reserve',
        title: 'USDC - Save main',
        asset: USDC_ASSET,
        apy: { current: 0.0191, source: 'fixture.save.reserve.details', window: 'current_supply_interest' },
        tvl: { usd: 29_650_000 },
        liquidity: { utilizationPct: 62.5, withdrawalBufferPct: 37.5 },
        risk: {
          tier: 'moderate',
          score: 34,
          factors: ['main Save/Solend market reserve', 'normal utilization', 'classic lending reserve mechanics'],
          synthesis: 'Fixture-backed Save/Solend main USDC reserve with moderate utilization and classic reserve mechanics.'
        },
        flags: { depositable: true, simulatable: true },
        refs: {
          market: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY',
          reserve: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
          assetMint: USDC_ASSET.mint
        },
        evidence: [
          {
            label: 'Save reserve details',
            url: 'https://api.save.finance/v1/reserves?ids=BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
            observedAt: generatedAt
          }
        ],
        generated_at: generatedAt
      })
    ]
  };
}

async function buildLiveCatalogue(config: AppConfig, generatedAt: string): Promise<SavingsCatalogue> {
  const markets = asArray<SaveMarketConfig>(
    await getJson<unknown>(config.saveSolendApiBaseUrl, '/markets/configs?scope=all', config.requestTimeoutMs)
  );
  const candidates = markets.flatMap((market) =>
    asArray<SaveReserveConfig>(market.reserves).map((configReserve) => ({ market, configReserve }))
  );
  const usdc = candidates.find((entry) => entry.configReserve.liquidityToken?.mint === CANONICAL_SOLANA_USDC_MINT);
  if (!usdc || typeof usdc.configReserve.address !== 'string') {
    return {
      asset: USDC_ASSET,
      generated_at: generatedAt,
      source: {
        venue: 'Save/Solend',
        mode: 'live',
        baseUrl: config.saveSolendApiBaseUrl
      },
      opportunities: [],
      warnings: ['Save/Solend live config returned no canonical USDC reserve']
    };
  }

  const detailsPayload = (await getJson<{ results?: SaveReserveDetails[] }>(
    config.saveSolendApiBaseUrl,
    `/reserves?ids=${usdc.configReserve.address}`,
    config.requestTimeoutMs
  )) as { results?: SaveReserveDetails[] };
  const details = detailsPayload.results?.[0];
  const opportunity = details ? normalizeReserve({ ...usdc, details, generatedAt }) : null;

  const catalogue: SavingsCatalogue = {
    asset: USDC_ASSET,
    generated_at: generatedAt,
    source: {
      venue: 'Save/Solend',
      mode: 'live',
      baseUrl: config.saveSolendApiBaseUrl
    },
    opportunities: opportunity ? [opportunity] : []
  };
  if (!opportunity) catalogue.warnings = ['Save/Solend live reserve details could not normalize canonical USDC'];
  return catalogue;
}

export function createSaveSolendVenueAdapter(config: AppConfig): VenueAdapter {
  return {
    id: 'save_solend',
    name: 'Save/Solend',
    async listUsdcOpportunities(options = {}) {
      const now = Date.now();
      const generatedAt = new Date(now).toISOString();
      if (config.useFixtureCatalogue) return fixtureCatalogue(generatedAt);

      if (!options.refresh && cache && now - cache.at < config.cacheTtlMs) return cache.data;

      const data = await buildLiveCatalogue(config, generatedAt);
      cache = { at: now, data };
      return data;
    }
  };
}
