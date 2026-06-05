import { CANONICAL_SOLANA_USDC_MINT, USDC_ASSET } from '../constants.js';
import { attachOpportunityDisplay } from '../core/display.js';
import type { AppConfig, SavingsCatalogue, SavingsOpportunity } from '../types.js';
import type { VenueAdapter } from './types.js';

const JUPITER_USDC_RECEIPT_MINT = '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D';

let cache: { at: number; data: SavingsCatalogue } | null = null;

interface JupiterEarnToken {
  id?: unknown;
  address?: unknown;
  symbol?: unknown;
  assetAddress?: unknown;
  totalAssets?: unknown;
  supplyRate?: unknown;
  rewardsRate?: unknown;
  totalRate?: unknown;
  liquiditySupplyData?: {
    withdrawalLimit?: unknown;
    withdrawable?: unknown;
  };
  asset?: {
    price?: unknown;
    updatedAt?: unknown;
  };
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs: number): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`Jupiter Lend ${path} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rateBpsToDecimal(value: unknown): number {
  return numberValue(value) / 10_000;
}

function baseUnitsToUi(value: unknown, decimals = 6): number {
  return numberValue(value) / 10 ** decimals;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeToken(token: JupiterEarnToken, generatedAt: string): SavingsOpportunity | null {
  if (token.assetAddress !== CANONICAL_SOLANA_USDC_MINT) return null;

  const totalAssetsUi = baseUnitsToUi(token.totalAssets);
  const assetPrice = numberValue(token.asset?.price) || 1;
  const tvlUsd = totalAssetsUi * assetPrice;
  const withdrawableUi = baseUnitsToUi(token.liquiditySupplyData?.withdrawable);
  const withdrawalBufferPct = totalAssetsUi > 0 ? round2((withdrawableUi / totalAssetsUi) * 100) : null;
  const totalApy = rateBpsToDecimal(token.totalRate);
  const baseApy = rateBpsToDecimal(token.supplyRate);
  const rewardsApy = rateBpsToDecimal(token.rewardsRate);

  return attachOpportunityDisplay({
    id: 'jupiter:earn:usdc',
    venue: 'Jupiter Lend',
    protocol: 'jupiter_lend',
    product_type: 'vault',
    title: 'USDC Jupiter Earn',
    asset: USDC_ASSET,
    apy: {
      current: totalApy,
      source: 'jupiter_lend.earn.tokens',
      window: 'current_total_rate'
    },
    tvl: { usd: tvlUsd },
    liquidity: {
      utilizationPct: null,
      withdrawalBufferPct
    },
    risk: {
      tier: 'moderate',
      score: 34,
      factors: [
        'unified Jupiter Earn liquidity layer',
        'jlUSDC receipt token exposure',
        'automated debt-ceiling withdrawal mechanics',
        rewardsApy > 0 ? 'reward APY component' : 'no separate reward APY currently reported'
      ],
      synthesis:
        'USDC deposited into Jupiter Earn receives jlUSDC exposure; withdrawals depend on Jupiter Lend liquidity and debt-ceiling mechanics rather than a simple reserve idle buffer.'
    },
    flags: {
      depositable: true,
      simulatable: false
    },
    refs: {
      vault: typeof token.address === 'string' ? token.address : JUPITER_USDC_RECEIPT_MINT,
      assetMint: CANONICAL_SOLANA_USDC_MINT
    },
    evidence: [
      {
        label: 'Jupiter Lend Earn tokens',
        url: 'https://lite-api.jup.ag/lend/v1/earn/tokens',
        observedAt: generatedAt
      }
    ],
    generated_at: generatedAt
  });
}

function fixtureCatalogue(generatedAt: string): SavingsCatalogue {
  return {
    asset: USDC_ASSET,
    generated_at: generatedAt,
    source: {
      venue: 'Jupiter Lend',
      mode: 'fixture',
      baseUrl: 'https://lite-api.jup.ag/lend/v1'
    },
    opportunities: [
      attachOpportunityDisplay({
        id: 'jupiter:earn:usdc',
        venue: 'Jupiter Lend',
        protocol: 'jupiter_lend',
        product_type: 'vault',
        title: 'USDC Jupiter Earn',
        asset: USDC_ASSET,
        apy: { current: 0.0407, source: 'fixture.jupiter_lend.earn.tokens', window: 'current_total_rate' },
        tvl: { usd: 426_900_000 },
        liquidity: { utilizationPct: null, withdrawalBufferPct: 21.5 },
        risk: {
          tier: 'moderate',
          score: 34,
          factors: ['unified earn pool', 'jlUSDC receipt token', 'debt-ceiling withdrawal mechanics'],
          synthesis:
            'Fixture-backed Jupiter Earn USDC pool with jlUSDC receipt exposure and withdrawal mechanics that differ from lending-reserve idle buffers.'
        },
        flags: { depositable: true, simulatable: false },
        refs: { vault: JUPITER_USDC_RECEIPT_MINT, assetMint: USDC_ASSET.mint },
        evidence: [
          {
            label: 'Jupiter Lend Earn tokens',
            url: 'https://lite-api.jup.ag/lend/v1/earn/tokens',
            observedAt: generatedAt
          }
        ],
        generated_at: generatedAt
      })
    ]
  };
}

async function buildLiveCatalogue(config: AppConfig, generatedAt: string): Promise<SavingsCatalogue> {
  const tokens = asArray<JupiterEarnToken>(
    await getJson<unknown>(config.jupiterLendApiBaseUrl, '/earn/tokens', config.requestTimeoutMs)
  );
  const opportunities = tokens.map((token) => normalizeToken(token, generatedAt)).filter((item): item is SavingsOpportunity => Boolean(item));

  return {
    asset: USDC_ASSET,
    generated_at: generatedAt,
    source: {
      venue: 'Jupiter Lend',
      mode: 'live',
      baseUrl: config.jupiterLendApiBaseUrl
    },
    opportunities,
    warnings: opportunities.length === 0 ? ['Jupiter Lend live API returned no canonical USDC Earn token'] : undefined
  };
}

export function createJupiterLendVenueAdapter(config: AppConfig): VenueAdapter {
  return {
    id: 'jupiter_lend',
    name: 'Jupiter Lend',
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
