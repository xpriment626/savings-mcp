import { createTool } from '@mastra/core/tools';

import { compareOpportunities, proposeAllocation } from '../../allocation.js';
import { getFilteredOpportunities, getUsdcCatalogue } from '../../catalogue.js';
import {
  calculateBlendedApy,
  calculateBlendedRisk,
  calculateCapacityMetrics,
  calculateConcentration,
  calculateLiquidityMetrics,
  calculateOpportunityAnalytics,
  calculateRateMetrics,
  calculateRebalanceDelta,
  calculateStrategyExposure,
  getMetricPacket,
  getOpportunity,
  rankOpportunities,
  screenOpportunities,
  validateAllocationInputs
} from '../../current-analytics.js';
import {
  calculateHistoricalLiquidityRisk,
  calculateRateStability,
  calculateYieldPercentiles,
  compareHistoricalOpportunities,
  detectHistoryAnomalies,
  getHistorySampleSchema,
  summarizeHistoryQuality,
  validateHistorySamples
} from '../../history-analytics.js';
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
  allocationValidationOutputSchema,
  allocationWeightsInputSchema,
  blendedApyOutputSchema,
  blendedRiskOutputSchema,
  capacityUtilizationAnalysisSchema,
  compareOpportunitiesInputSchema,
  concentrationOutputSchema,
  currentOpportunityAnalyticsOutputSchema,
  dataQualityInputSchema,
  dataQualityReportSchema,
  exitLiquidityAnalysisSchema,
  getOpportunityOutputSchema,
  historicalComparisonOutputSchema,
  historicalLiquidityRiskOutputSchema,
  historyAnalyticsInputSchema,
  historyAnomalyOutputSchema,
  historyComparisonInputSchema,
  historyQualityOutputSchema,
  historySampleSchemaOutputSchema,
  historyValidationOutputSchema,
  metricPacketInputSchema,
  metricPacketSchema,
  opportunityLookupInputSchema,
  proposeAllocationInputSchema,
  rankOpportunitiesInputSchema,
  rankOpportunitiesOutputSchema,
  rateQualityAnalysisSchema,
  rateStabilityOutputSchema,
  rebalanceDeltaInputSchema,
  rebalanceDeltaOutputSchema,
  savingsCatalogueSchema,
  screenOpportunitiesInputSchema,
  screenOpportunitiesOutputSchema,
  searchUsdcOpportunitiesInputSchema,
  strategyExposureAnalysisSchema,
  yieldPercentilesOutputSchema
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
    description: 'Compare USDC savings opportunities while preserving APY, liquidity, risk, connector capabilities, limitations, and evidence payloads.',
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

  const getOpportunityTool = createTool({
    id: 'get-opportunity',
    description: 'Return one normalized USDC opportunity with connector capabilities, limitations, display metadata, and evidence.',
    inputSchema: opportunityLookupInputSchema,
    outputSchema: getOpportunityOutputSchema,
    execute: async (inputData) => getOpportunity(config, inputData)
  });

  const calculateOpportunityAnalyticsTool = createTool({
    id: 'calculate-opportunity-analytics',
    description: 'Return decomposed current-snapshot analytics for one opportunity without choosing allocation weights.',
    inputSchema: opportunityLookupInputSchema,
    outputSchema: currentOpportunityAnalyticsOutputSchema,
    execute: async (inputData) => calculateOpportunityAnalytics(config, inputData)
  });

  const calculateRateMetricsTool = createTool({
    id: 'calculate-rate-metrics',
    description: 'Calculate rate-source and APY-quality metrics for one opportunity.',
    inputSchema: opportunityLookupInputSchema,
    outputSchema: rateQualityAnalysisSchema,
    execute: async (inputData) => calculateRateMetrics(config, inputData)
  });

  const calculateLiquidityMetricsTool = createTool({
    id: 'calculate-liquidity-metrics',
    description: 'Calculate exit-liquidity and withdrawal-path metrics for one opportunity.',
    inputSchema: opportunityLookupInputSchema,
    outputSchema: exitLiquidityAnalysisSchema,
    execute: async (inputData) => calculateLiquidityMetrics(config, inputData)
  });

  const calculateCapacityMetricsTool = createTool({
    id: 'calculate-capacity-metrics',
    description: 'Calculate current TVL, utilization, connector coverage, and capacity signals for one opportunity.',
    inputSchema: opportunityLookupInputSchema,
    outputSchema: capacityUtilizationAnalysisSchema,
    execute: async (inputData) => calculateCapacityMetrics(config, inputData)
  });

  const calculateStrategyExposureTool = createTool({
    id: 'calculate-strategy-exposure',
    description: 'Classify reserve, managed-vault, external-strategy, and LP-style exposure for one opportunity.',
    inputSchema: opportunityLookupInputSchema,
    outputSchema: strategyExposureAnalysisSchema,
    execute: async (inputData) => calculateStrategyExposure(config, inputData)
  });

  const screenOpportunitiesTool = createTool({
    id: 'screen-opportunities',
    description: 'Screen opportunities by venue, product type, TVL, APY, risk, withdrawal buffer, or integration status while returning included and excluded rows.',
    inputSchema: screenOpportunitiesInputSchema,
    outputSchema: screenOpportunitiesOutputSchema,
    execute: async (inputData) => screenOpportunities(config, inputData)
  });

  const rankOpportunitiesTool = createTool({
    id: 'rank-opportunities',
    description: 'Rank current normalized opportunities by risk-adjusted APY, APY, TVL, risk, or liquidity.',
    inputSchema: rankOpportunitiesInputSchema,
    outputSchema: rankOpportunitiesOutputSchema,
    execute: async (inputData) => rankOpportunities(config, inputData)
  });

  const calculateBlendedApyTool = createTool({
    id: 'calculate-blended-apy',
    description: 'Calculate weighted blended headline APY from caller-supplied opportunity weights.',
    inputSchema: allocationWeightsInputSchema,
    outputSchema: blendedApyOutputSchema,
    execute: async (inputData) => calculateBlendedApy(config, inputData)
  });

  const calculateBlendedRiskTool = createTool({
    id: 'calculate-blended-risk',
    description: 'Calculate weighted blended risk score and risk envelope from caller-supplied opportunity weights.',
    inputSchema: allocationWeightsInputSchema,
    outputSchema: blendedRiskOutputSchema,
    execute: async (inputData) => calculateBlendedRisk(config, inputData)
  });

  const calculateConcentrationTool = createTool({
    id: 'calculate-concentration',
    description: 'Calculate venue, product, integration-status, and opportunity concentration from caller-supplied weights.',
    inputSchema: allocationWeightsInputSchema,
    outputSchema: concentrationOutputSchema,
    execute: async (inputData) => calculateConcentration(config, inputData)
  });

  const calculateRebalanceDeltaTool = createTool({
    id: 'calculate-rebalance-delta',
    description: 'Calculate current-to-target allocation deltas from caller-supplied weights and optional amount.',
    inputSchema: rebalanceDeltaInputSchema,
    outputSchema: rebalanceDeltaOutputSchema,
    execute: async (inputData) => calculateRebalanceDelta(config, inputData)
  });

  const validateAllocationInputsTool = createTool({
    id: 'validate-allocation-inputs',
    description: 'Validate caller-supplied opportunity weights, totals, duplicates, missing ids, and optional amount.',
    inputSchema: allocationWeightsInputSchema,
    outputSchema: allocationValidationOutputSchema,
    execute: async (inputData) => validateAllocationInputs(config, inputData)
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

  const getHistorySampleSchemaTool = createTool({
    id: 'get-history-sample-schema',
    description: 'Describe the caller-supplied history sample and summary shapes expected by stateless historical tools.',
    inputSchema: undefined,
    outputSchema: historySampleSchemaOutputSchema,
    execute: async () => getHistorySampleSchema()
  });

  const validateHistorySamplesTool = createTool({
    id: 'validate-history-samples',
    description: 'Validate caller-supplied opportunity history samples or summaries without storing them.',
    inputSchema: historyAnalyticsInputSchema,
    outputSchema: historyValidationOutputSchema,
    execute: async (inputData) => validateHistorySamples(inputData)
  });

  const summarizeHistoryQualityTool = createTool({
    id: 'summarize-history-quality',
    description: 'Summarize coverage, completeness, and quality of caller-supplied history samples or summaries.',
    inputSchema: historyAnalyticsInputSchema,
    outputSchema: historyQualityOutputSchema,
    execute: async (inputData) => summarizeHistoryQuality(inputData)
  });

  const calculateRateStabilityTool = createTool({
    id: 'calculate-rate-stability',
    description: 'Calculate APY mean, volatility, percentiles, regime, and stability score from caller-supplied history.',
    inputSchema: historyAnalyticsInputSchema,
    outputSchema: rateStabilityOutputSchema,
    execute: async (inputData) => calculateRateStability(inputData)
  });

  const calculateYieldPercentilesTool = createTool({
    id: 'calculate-yield-percentiles',
    description: 'Calculate APY percentiles from caller-supplied history samples or a precomputed summary.',
    inputSchema: historyAnalyticsInputSchema,
    outputSchema: yieldPercentilesOutputSchema,
    execute: async (inputData) => calculateYieldPercentiles(inputData)
  });

  const calculateHistoricalLiquidityRiskTool = createTool({
    id: 'calculate-historical-liquidity-risk',
    description: 'Calculate historical utilization and withdrawal-buffer risk from caller-supplied history.',
    inputSchema: historyAnalyticsInputSchema,
    outputSchema: historicalLiquidityRiskOutputSchema,
    execute: async (inputData) => calculateHistoricalLiquidityRisk(inputData)
  });

  const detectHistoryAnomaliesTool = createTool({
    id: 'detect-history-anomalies',
    description: 'Detect APY spikes, APY drops, TVL drops, withdrawal-buffer drops, and utilization spikes from caller-supplied samples.',
    inputSchema: historyAnalyticsInputSchema,
    outputSchema: historyAnomalyOutputSchema,
    execute: async (inputData) => detectHistoryAnomalies(inputData)
  });

  const compareHistoricalOpportunitiesTool = createTool({
    id: 'compare-historical-opportunities',
    description: 'Compare multiple caller-supplied histories by rate stability, liquidity risk, and anomaly count.',
    inputSchema: historyComparisonInputSchema,
    outputSchema: historicalComparisonOutputSchema,
    execute: async (inputData) => compareHistoricalOpportunities(inputData)
  });

  return {
    searchUsdcOpportunitiesTool,
    compareOpportunitiesTool,
    proposeAllocationTool,
    getMetricPacketTool,
    getOpportunityTool,
    calculateOpportunityAnalyticsTool,
    calculateRateMetricsTool,
    calculateLiquidityMetricsTool,
    calculateCapacityMetricsTool,
    calculateStrategyExposureTool,
    screenOpportunitiesTool,
    rankOpportunitiesTool,
    calculateBlendedApyTool,
    calculateBlendedRiskTool,
    calculateConcentrationTool,
    calculateRebalanceDeltaTool,
    validateAllocationInputsTool,
    analyzeDataQualityTool,
    getHistorySampleSchemaTool,
    validateHistorySamplesTool,
    summarizeHistoryQualityTool,
    calculateRateStabilityTool,
    calculateYieldPercentilesTool,
    calculateHistoricalLiquidityRiskTool,
    detectHistoryAnomaliesTool,
    compareHistoricalOpportunitiesTool
  };
}

export const savingsMastraTools = createSavingsMastraTools();
