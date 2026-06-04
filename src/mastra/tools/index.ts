import { createTool } from '@mastra/core/tools';

import { compareOpportunities, proposeAllocation } from '../../allocation.js';
import { getFilteredOpportunities, getUsdcCatalogue } from '../../catalogue.js';
import { buildDataQualityReport, buildMetricPacket } from '../../core/metrics.js';
import {
  parseCompareOpportunitiesArgs,
  parseFilterOpportunitiesArgs,
  parseProposeAllocationArgs
} from '../../core/tool-args.js';
import { loadConfig } from '../../config.js';
import type { AppConfig } from '../../types.js';
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

function bindConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig(), ...overrides };
}

export { buildDataQualityReport, buildMetricPacket };

export function createSavingsMastraTools(overrides: Partial<AppConfig> = {}) {
  const config = bindConfig(overrides);

  const searchUsdcOpportunitiesTool = createTool({
    id: 'search-usdc-opportunities',
    description: 'Search normalized canonical Solana USDC savings opportunities. Pure infra: no auth, custody, signing, or persistence.',
    inputSchema: searchUsdcOpportunitiesInputSchema,
    outputSchema: savingsCatalogueSchema,
    execute: async (inputData) => getFilteredOpportunities(config, parseFilterOpportunitiesArgs(inputData))
  });

  const compareOpportunitiesTool = createTool({
    id: 'compare-opportunities',
    description: 'Compare USDC savings opportunities while preserving APY, liquidity, risk, flags, and evidence payloads.',
    inputSchema: compareOpportunitiesInputSchema,
    execute: async (inputData) => compareOpportunities(config, parseCompareOpportunitiesArgs(inputData))
  });

  const proposeAllocationTool = createTool({
    id: 'propose-allocation',
    description: 'Create a deterministic allocation preview across selected USDC opportunities. Agents do not choose weights.',
    inputSchema: proposeAllocationInputSchema,
    outputSchema: allocationOutputSchema,
    execute: async (inputData) => proposeAllocation(config, parseProposeAllocationArgs(inputData))
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
