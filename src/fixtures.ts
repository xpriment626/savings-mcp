import { USDC_ASSET } from './constants.js';
import { connectorCapabilities, integrationLimitations, integrationStatusFor } from './core/capabilities.js';
import { attachOpportunityDisplay } from './core/display.js';
import type { SavingsCatalogue } from './types.js';

function connectorFields(input: { depositTxKnown: boolean; simulationSupported?: boolean }, extra: readonly string[] = []) {
  const capabilities = connectorCapabilities(input);
  return {
    capabilities,
    integrationStatus: integrationStatusFor(capabilities),
    limitations: integrationLimitations(capabilities, extra)
  };
}

export function fixtureCatalogue(generatedAt = new Date().toISOString()): SavingsCatalogue {
  return {
    asset: USDC_ASSET,
    generated_at: generatedAt,
    source: {
      venue: 'Kamino',
      mode: 'fixture'
    },
    opportunities: [
      attachOpportunityDisplay({
        id: 'kamino:lend:main-usdc',
        venue: 'Kamino',
        protocol: 'kamino',
        product_type: 'lending_reserve',
        title: 'USDC Main Market',
        asset: USDC_ASSET,
        apy: { current: 0.044, source: 'fixture', window: 'current_supply_apy' },
        tvl: { usd: 165_000_000 },
        liquidity: { utilizationPct: 68, withdrawalBufferPct: 32 },
        risk: {
          tier: 'conservative',
          score: 18,
          factors: ['deep main-market liquidity', 'simple lending reserve', 'borrower-demand yield'],
          synthesis:
            'Blue-chip USDC lending on Kamino main market with deep supplied liquidity and simple reserve mechanics.'
        },
        ...connectorFields({ depositTxKnown: true }, ['fixture-backed Kamino reserve refs are illustrative']),
        refs: {
          market: 'main',
          reserve: 'fixture-main-usdc',
          assetMint: USDC_ASSET.mint
        },
        evidence: [
          {
            label: 'Kamino market metrics',
            url: 'https://api.kamino.finance/v2/kamino-market',
            observedAt: generatedAt
          }
        ],
        generated_at: generatedAt
      }),
      attachOpportunityDisplay({
        id: 'kamino:earn:usdc-core',
        venue: 'Kamino',
        protocol: 'kamino',
        product_type: 'vault',
        title: 'USDC Core Earn Vault',
        asset: USDC_ASSET,
        apy: { current: 0.061, source: 'fixture', window: '30d' },
        tvl: { usd: 21_500_000 },
        liquidity: { utilizationPct: null, withdrawalBufferPct: null },
        risk: {
          tier: 'moderate',
          score: 36,
          factors: ['managed vault allocations', 'curator dependency', 'underlying reserve exposure'],
          synthesis:
            'Managed USDC vault with higher yield potential, but risk follows curator choices and underlying reserve mix.'
        },
        ...connectorFields({ depositTxKnown: false }, ['fixture-backed Kamino vault deposit mechanics are not normalized']),
        refs: {
          vault: 'fixture-usdc-core-vault',
          assetMint: USDC_ASSET.mint
        },
        evidence: [
          {
            label: 'Kamino vault metrics',
            url: 'https://api.kamino.finance/kvaults/vaults',
            observedAt: generatedAt
          }
        ],
        generated_at: generatedAt
      }),
      attachOpportunityDisplay({
        id: 'kamino:lend:alt-usdc',
        venue: 'Kamino',
        protocol: 'kamino',
        product_type: 'lending_reserve',
        title: 'USDC Isolated Market',
        asset: USDC_ASSET,
        apy: { current: 0.083, source: 'fixture', window: 'current_supply_apy' },
        tvl: { usd: 4_200_000 },
        liquidity: { utilizationPct: 92, withdrawalBufferPct: 8 },
        risk: {
          tier: 'elevated',
          score: 58,
          factors: ['thinner market', 'higher utilization', 'withdrawal-liquidity sensitivity'],
          synthesis:
            'Higher-yield USDC lending in a thinner market; high utilization can make exits less immediate.'
        },
        ...connectorFields({ depositTxKnown: true }, ['fixture-backed isolated reserve refs are illustrative']),
        refs: {
          market: 'isolated',
          reserve: 'fixture-alt-usdc',
          assetMint: USDC_ASSET.mint
        },
        evidence: [
          {
            label: 'Kamino reserve metrics',
            url: 'https://api.kamino.finance/kamino-market/{market}/reserves/metrics',
            observedAt: generatedAt
          }
        ],
        generated_at: generatedAt
      })
    ]
  };
}
