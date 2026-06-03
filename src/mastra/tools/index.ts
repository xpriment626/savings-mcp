import { createTool } from '@mastra/core/tools';

import { compareOpportunities, proposeAllocation } from '../../allocation.js';
import { getFilteredOpportunities, getUsdcCatalogue } from '../../catalogue.js';
import { loadConfig } from '../../config.js';
import type {
  AppConfig,
  CompareOpportunitiesArgs,
  FilterOpportunitiesArgs,
  ProposeAllocationArgs,
  SavingsCatalogue,
  SavingsOpportunity
} from '../../types.js';
import {
  allocationOutputSchema,
  compareOpportunitiesInputSchema,
  dataQualityInputSchema,
  dataQualityReportSchema,
  metricPacketInputSchema,
  metricPacketSchema,
  proposeAllocationInputSchema,
  savingsCatalogueSchema,
  searchUsdcOpportunitiesInputSchema
} from '../schemas/savings.js';
import type { DataQualityReport, MetricPacket } from '../schemas/savings.js';

function bindConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig(), ...overrides };
}

function filterArgs(inputData: {
  refresh?: boolean | undefined;
  limit?: number | undefined;
  minTvlUsd?: number | undefined;
  productTypes?: Array<'lending_reserve' | 'vault'> | undefined;
}): FilterOpportunitiesArgs {
  const args: FilterOpportunitiesArgs = {};
  if (inputData.refresh !== undefined) args.refresh = inputData.refresh;
  if (inputData.limit !== undefined) args.limit = inputData.limit;
  if (inputData.minTvlUsd !== undefined) args.minTvlUsd = inputData.minTvlUsd;
  if (inputData.productTypes !== undefined) args.productTypes = inputData.productTypes;
  return args;
}

function compareArgs(inputData: { opportunityIds?: string[] | undefined; refresh?: boolean | undefined }): CompareOpportunitiesArgs {
  const args: CompareOpportunitiesArgs = {};
  if (inputData.opportunityIds !== undefined) args.opportunityIds = inputData.opportunityIds;
  if (inputData.refresh !== undefined) args.refresh = inputData.refresh;
  return args;
}

function proposeArgs(inputData: {
  opportunityIds: string[];
  amountUsd: number;
  riskPreference?: 'conservative' | 'balanced' | 'aggressive' | undefined;
  nudges?: Array<'more_conservative' | 'more_aggressive' | 'fewer_pools'> | undefined;
  refresh?: boolean | undefined;
}): ProposeAllocationArgs {
  const args: ProposeAllocationArgs = {
    opportunityIds: inputData.opportunityIds,
    amountUsd: inputData.amountUsd
  };
  if (inputData.riskPreference !== undefined) args.riskPreference = inputData.riskPreference;
  if (inputData.nudges !== undefined) args.nudges = inputData.nudges;
  if (inputData.refresh !== undefined) args.refresh = inputData.refresh;
  return args;
}

function withdrawalModeFor(opportunity: SavingsOpportunity): MetricPacket['liquidity']['withdrawalMode'] {
  if (opportunity.product_type === 'vault') return 'unknown';
  if (opportunity.liquidity.withdrawalBufferPct !== null) return 'buffer';
  return 'unknown';
}

function usesExternalStrategies(opportunity: SavingsOpportunity): boolean {
  return opportunity.product_type === 'vault';
}

export function buildMetricPacket(opportunity: SavingsOpportunity): MetricPacket {
  return {
    opportunityId: opportunity.id,
    venue: opportunity.venue,
    protocol: opportunity.protocol,
    productType: opportunity.product_type,
    fetchedAt: opportunity.generated_at,
    rate: {
      currentApy: opportunity.apy.current,
      source: opportunity.apy.source,
      window: opportunity.apy.window
    },
    scale: {
      tvlUsd: opportunity.tvl.usd
    },
    liquidity: {
      utilizationPct: opportunity.liquidity.utilizationPct,
      withdrawalBufferPct: opportunity.liquidity.withdrawalBufferPct,
      withdrawalMode: withdrawalModeFor(opportunity)
    },
    riskInputs: {
      tier: opportunity.risk.tier,
      score: opportunity.risk.score,
      factors: opportunity.risk.factors,
      synthesis: opportunity.risk.synthesis,
      venueSpecific: {
        refs: opportunity.refs,
        productType: opportunity.product_type
      }
    },
    receipt: {
      mint: opportunity.refs.vault,
      symbol: opportunity.product_type === 'vault' ? opportunity.title : undefined
    },
    flags: {
      depositable: opportunity.flags.depositable,
      simulatable: opportunity.flags.simulatable,
      requiresKyc: false,
      accessGated: false,
      hasLpExposure: false,
      usesExternalStrategies: usesExternalStrategies(opportunity)
    },
    evidence: opportunity.evidence
  };
}

function opportunityWarnings(opportunity: SavingsOpportunity): string[] {
  const warnings: string[] = [];
  if (opportunity.evidence.length === 0) warnings.push('missing evidence');
  if (!Number.isFinite(opportunity.apy.current)) warnings.push('APY is not finite');
  if (opportunity.tvl.usd <= 0) warnings.push('TVL is missing or zero');
  if (!opportunity.flags.depositable) warnings.push('opportunity is not currently marked depositable');
  if (opportunity.product_type === 'vault') warnings.push('managed vault strategy details are not fully normalized yet');
  return warnings;
}

export function buildDataQualityReport(
  catalogue: SavingsCatalogue,
  opportunityIds: readonly string[] | undefined = undefined
): DataQualityReport {
  const ids = opportunityIds ? new Set(opportunityIds) : null;
  const opportunities = ids ? catalogue.opportunities.filter((opportunity) => ids.has(opportunity.id)) : catalogue.opportunities;
  const warnings: string[] = [];
  if (catalogue.source.mode === 'fixture') warnings.push('catalogue is fixture-backed; do not treat metrics as live market data');
  if (opportunities.length === 0) warnings.push('no opportunities matched the data quality request');

  const opportunityReports = opportunities.map((opportunity) => {
    const itemWarnings = opportunityWarnings(opportunity);
    return {
      opportunityId: opportunity.id,
      status: itemWarnings.length > 0 ? ('warning' as const) : ('ok' as const),
      warnings: itemWarnings,
      evidenceCount: opportunity.evidence.length
    };
  });

  return {
    checkedAt: new Date().toISOString(),
    mode: catalogue.source.mode,
    warnings,
    opportunityReports
  };
}

export function createSavingsMastraTools(overrides: Partial<AppConfig> = {}) {
  const config = bindConfig(overrides);

  const searchUsdcOpportunitiesTool = createTool({
    id: 'search-usdc-opportunities',
    description: 'Search normalized canonical Solana USDC savings opportunities. Pure infra: no auth, custody, signing, or persistence.',
    inputSchema: searchUsdcOpportunitiesInputSchema,
    outputSchema: savingsCatalogueSchema,
    execute: async (inputData) => getFilteredOpportunities(config, filterArgs(inputData))
  });

  const compareOpportunitiesTool = createTool({
    id: 'compare-opportunities',
    description: 'Compare USDC savings opportunities while preserving APY, liquidity, risk, flags, and evidence payloads.',
    inputSchema: compareOpportunitiesInputSchema,
    execute: async (inputData) => compareOpportunities(config, compareArgs(inputData))
  });

  const proposeAllocationTool = createTool({
    id: 'propose-allocation',
    description: 'Create a deterministic allocation preview across selected USDC opportunities. Agents do not choose weights.',
    inputSchema: proposeAllocationInputSchema,
    outputSchema: allocationOutputSchema,
    execute: async (inputData) => proposeAllocation(config, proposeArgs(inputData))
  });

  const getMetricPacketTool = createTool({
    id: 'get-metric-packet',
    description: 'Return a normalized metric packet for one opportunity for downstream specialist agents.',
    inputSchema: metricPacketInputSchema,
    outputSchema: metricPacketSchema,
    execute: async (inputData) => {
      const catalogue = await getUsdcCatalogue(config, { refresh: Boolean(inputData.refresh) });
      const opportunity = catalogue.opportunities.find((item) => item.id === inputData.opportunityId);
      if (!opportunity) throw new Error(`unknown opportunity ${inputData.opportunityId}`);
      return buildMetricPacket(opportunity);
    }
  });

  const analyzeDataQualityTool = createTool({
    id: 'analyze-data-quality',
    description: 'Deterministically report fixture/live mode, stale or missing evidence, and normalization gaps.',
    inputSchema: dataQualityInputSchema,
    outputSchema: dataQualityReportSchema,
    execute: async (inputData) => {
      const catalogue = await getUsdcCatalogue(config, { refresh: Boolean(inputData.refresh) });
      return buildDataQualityReport(catalogue, inputData.opportunityIds);
    }
  });

  return {
    searchUsdcOpportunitiesTool,
    compareOpportunitiesTool,
    proposeAllocationTool,
    getMetricPacketTool,
    analyzeDataQualityTool
  };
}

export const savingsMastraTools = createSavingsMastraTools();
