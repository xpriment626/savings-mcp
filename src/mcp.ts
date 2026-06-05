import { z } from 'zod';

import { compareOpportunities, proposeAllocation } from './allocation.js';
import { getFilteredOpportunities, getUsdcCatalogue } from './catalogue.js';
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
} from './current-analytics.js';
import {
  allocationOutputSchema,
  allocationValidationOutputSchema,
  allocationWeightsInputSchema,
  blendedApyOutputSchema,
  blendedRiskOutputSchema,
  capacityUtilizationAnalysisSchema,
  concentrationOutputSchema,
  compareOpportunitiesOutputSchema,
  currentOpportunityAnalyticsOutputSchema,
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
  rankOpportunitiesInputSchema,
  rankOpportunitiesOutputSchema,
  rateQualityAnalysisSchema,
  rateStabilityOutputSchema,
  rebalanceDeltaInputSchema,
  rebalanceDeltaOutputSchema,
  savingsCatalogueSchema,
  screenOpportunitiesInputSchema,
  screenOpportunitiesOutputSchema,
  strategyExposureAnalysisSchema,
  yieldPercentilesOutputSchema
} from './core/schemas.js';
import {
  parseCompareOpportunitiesArgs,
  parseFilterOpportunitiesArgs,
  parseProposeAllocationArgs
} from './core/tool-args.js';
import {
  calculateHistoricalLiquidityRisk,
  calculateRateStability,
  calculateYieldPercentiles,
  compareHistoricalOpportunities,
  detectHistoryAnomalies,
  getHistorySampleSchema,
  summarizeHistoryQuality,
  validateHistorySamples
} from './history-analytics.js';
import type {
  AppConfig,
  JsonRpcRequest,
  JsonRpcResponse
} from './types.js';

const PURE_INFRA_BOUNDARY =
  'Does not authenticate users, sign, send transactions, custody funds, or maintain ledgers.';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true
} as const;

function jsonSchemaFor(schema: z.ZodType) {
  return z.toJSONSchema(schema);
}

function inputRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseArgs<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(inputRecord(value));
}

const TOOLS = [
  {
    name: 'get_usdc_opportunities',
    title: 'Get USDC opportunities',
    description:
      `Use when the user asks what canonical Solana USDC savings opportunities are available. Returns typed opportunity data, display summaries, provenance, risk, liquidity, connector capabilities, and integration limitations. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean' },
        limit: { type: 'number' },
        minTvlUsd: { type: 'number' },
        productTypes: {
          type: 'array',
          items: { enum: ['lending_reserve', 'vault'] }
        }
      }
    },
    outputSchema: jsonSchemaFor(savingsCatalogueSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'compare_opportunities',
    title: 'Compare USDC opportunities',
    description:
      `Use when the user wants to compare selected USDC opportunities by APY, liquidity, risk, connector capabilities, and evidence. Returns sorted typed comparison rows with display summaries. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: {
      type: 'object',
      properties: {
        opportunityIds: { type: 'array', items: { type: 'string' } },
        refresh: { type: 'boolean' }
      }
    },
    outputSchema: jsonSchemaFor(compareOpportunitiesOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'propose_allocation',
    title: 'Propose allocation',
    description:
      `Use when the user asks for a deterministic USDC allocation preview across selected opportunities. Returns typed weights, display summaries, rationale, and preview-only warnings. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: {
      type: 'object',
      required: ['opportunityIds', 'amountUsd'],
      properties: {
        opportunityIds: { type: 'array', items: { type: 'string' } },
        amountUsd: { type: 'number' },
        riskPreference: { enum: ['conservative', 'balanced', 'aggressive'] },
        nudges: {
          type: 'array',
          items: { enum: ['more_conservative', 'more_aggressive', 'fewer_pools'] }
        },
        refresh: { type: 'boolean' }
      }
    },
    outputSchema: jsonSchemaFor(allocationOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'get_opportunity',
    title: 'Get opportunity',
    description:
      `Return one normalized USDC opportunity by id with capabilities, integration limitations, display metadata, and evidence. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(opportunityLookupInputSchema),
    outputSchema: jsonSchemaFor(getOpportunityOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'get_metric_packet',
    title: 'Get metric packet',
    description:
      `Return one normalized metric packet for downstream analytics or app-side agents. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(metricPacketInputSchema),
    outputSchema: jsonSchemaFor(metricPacketSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_opportunity_analytics',
    title: 'Calculate opportunity analytics',
    description:
      `Return rate, exit-liquidity, capacity, and strategy-exposure analytics for one opportunity without choosing an allocation. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(opportunityLookupInputSchema),
    outputSchema: jsonSchemaFor(currentOpportunityAnalyticsOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_rate_metrics',
    title: 'Calculate rate metrics',
    description:
      `Calculate current rate-source and APY-quality metrics for one opportunity. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(opportunityLookupInputSchema),
    outputSchema: jsonSchemaFor(rateQualityAnalysisSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_liquidity_metrics',
    title: 'Calculate liquidity metrics',
    description:
      `Calculate exit-liquidity and withdrawal-path metrics for one opportunity. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(opportunityLookupInputSchema),
    outputSchema: jsonSchemaFor(exitLiquidityAnalysisSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_capacity_metrics',
    title: 'Calculate capacity metrics',
    description:
      `Calculate current TVL, utilization, connector coverage, and capacity signals for one opportunity. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(opportunityLookupInputSchema),
    outputSchema: jsonSchemaFor(capacityUtilizationAnalysisSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_strategy_exposure',
    title: 'Calculate strategy exposure',
    description:
      `Classify reserve, managed-vault, external-strategy, and LP-style exposure for one opportunity. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(opportunityLookupInputSchema),
    outputSchema: jsonSchemaFor(strategyExposureAnalysisSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'screen_opportunities',
    title: 'Screen opportunities',
    description:
      `Screen current normalized opportunities by venue, product type, TVL, APY, risk, withdrawal buffer, or integration status while returning both included and excluded rows. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(screenOpportunitiesInputSchema),
    outputSchema: jsonSchemaFor(screenOpportunitiesOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'rank_opportunities',
    title: 'Rank opportunities',
    description:
      `Rank current normalized opportunities by risk-adjusted APY, APY, TVL, risk, or liquidity. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(rankOpportunitiesInputSchema),
    outputSchema: jsonSchemaFor(rankOpportunitiesOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_blended_apy',
    title: 'Calculate blended APY',
    description:
      `Calculate weighted blended headline APY from caller-supplied opportunity weights. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(allocationWeightsInputSchema),
    outputSchema: jsonSchemaFor(blendedApyOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_blended_risk',
    title: 'Calculate blended risk',
    description:
      `Calculate weighted blended risk score and risk envelope from caller-supplied opportunity weights. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(allocationWeightsInputSchema),
    outputSchema: jsonSchemaFor(blendedRiskOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_concentration',
    title: 'Calculate concentration',
    description:
      `Calculate venue, product, integration-status, and opportunity concentration from caller-supplied weights. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(allocationWeightsInputSchema),
    outputSchema: jsonSchemaFor(concentrationOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_rebalance_delta',
    title: 'Calculate rebalance delta',
    description:
      `Calculate current-to-target allocation deltas from caller-supplied weights and optional amount. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(rebalanceDeltaInputSchema),
    outputSchema: jsonSchemaFor(rebalanceDeltaOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'validate_allocation_inputs',
    title: 'Validate allocation inputs',
    description:
      `Validate caller-supplied opportunity weights, totals, duplicates, missing ids, and optional amount before an app uses them. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(allocationWeightsInputSchema),
    outputSchema: jsonSchemaFor(allocationValidationOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'get_history_sample_schema',
    title: 'Get history sample schema',
    description:
      `Describe the BYOD history sample and summary shapes expected by stateless historical analytics tools. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: jsonSchemaFor(historySampleSchemaOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'validate_history_samples',
    title: 'Validate history samples',
    description:
      `Validate caller-supplied opportunity history samples or summaries without storing them. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(historyAnalyticsInputSchema),
    outputSchema: jsonSchemaFor(historyValidationOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'summarize_history_quality',
    title: 'Summarize history quality',
    description:
      `Summarize coverage, completeness, and quality of caller-supplied history samples or summaries. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(historyAnalyticsInputSchema),
    outputSchema: jsonSchemaFor(historyQualityOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_rate_stability',
    title: 'Calculate rate stability',
    description:
      `Calculate APY mean, volatility, percentiles, regime, and stability score from caller-supplied history. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(historyAnalyticsInputSchema),
    outputSchema: jsonSchemaFor(rateStabilityOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_yield_percentiles',
    title: 'Calculate yield percentiles',
    description:
      `Calculate APY percentiles from caller-supplied history samples or precomputed summary. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(historyAnalyticsInputSchema),
    outputSchema: jsonSchemaFor(yieldPercentilesOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'calculate_historical_liquidity_risk',
    title: 'Calculate historical liquidity risk',
    description:
      `Calculate historical utilization and withdrawal-buffer risk from caller-supplied history. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(historyAnalyticsInputSchema),
    outputSchema: jsonSchemaFor(historicalLiquidityRiskOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'detect_history_anomalies',
    title: 'Detect history anomalies',
    description:
      `Detect APY spikes, APY drops, TVL drops, withdrawal-buffer drops, and utilization spikes from caller-supplied history samples. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(historyAnalyticsInputSchema),
    outputSchema: jsonSchemaFor(historyAnomalyOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'compare_historical_opportunities',
    title: 'Compare historical opportunities',
    description:
      `Compare multiple caller-supplied opportunity histories by rate stability, liquidity risk, and anomaly count. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: jsonSchemaFor(historyComparisonInputSchema),
    outputSchema: jsonSchemaFor(historicalComparisonOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  }
] as const;

const RESOURCES = [
  {
    uri: 'savings://catalogue',
    name: 'Savings catalogue',
    description: 'Full normalized canonical Solana USDC savings catalogue.',
    mimeType: 'application/json'
  },
  {
    uri: 'savings://opportunities/usdc',
    name: 'USDC opportunities',
    description: 'Canonical Solana USDC opportunities across supported venues.',
    mimeType: 'application/json'
  },
  {
    uri: 'savings://risk-model',
    name: 'Risk model',
    description: 'Current deterministic risk dimensions and scoring model.',
    mimeType: 'application/json'
  }
] as const;

function toolResult(payload: unknown, statusText: string) {
  return {
    structuredContent: payload,
    content: [
      {
        type: 'text',
        text: statusText
      }
    ]
  };
}

function riskModelResource() {
  return {
    scope: 'canonical Solana USDC principal only',
    global_base_risk: ['USDC issuer/freeze risk is base asset risk, not per-venue yield risk'],
    dimensions: [
      'venue smart contract risk',
      'liquidity and withdrawal risk',
      'utilization stress',
      'strategy complexity',
      'historical APY stability',
      'TVL/depth',
      'custody/signing/permission surface'
    ],
    tiers: ['conservative', 'moderate', 'elevated', 'high'],
    execution_rule:
      'Agents reason. Deterministic library code allocates and validates previews; auth, signing, transaction construction, transaction sending, and ledgers are external integrator responsibilities.'
  };
}

export async function handleMcpRequest(config: AppConfig, request: JsonRpcRequest | null | undefined): Promise<JsonRpcResponse> {
  const id = request?.id ?? null;
  const method = request?.method;
  const params = request?.params ?? {};
  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: 'savings-mcp',
            version: '0.1.0'
          }
        }
      };
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'resources/list') {
      return { jsonrpc: '2.0', id, result: { resources: RESOURCES } };
    }

    if (method === 'resources/read') {
      const uri = params.uri;
      if (typeof uri !== 'string') throw new Error('resource uri must be a string');

      let payload: unknown;
      if (uri === 'savings://catalogue' || uri === 'savings://opportunities/usdc') {
        payload = await getUsdcCatalogue(config, { refresh: Boolean(params.refresh) });
      } else if (uri === 'savings://risk-model') {
        payload = riskModelResource();
      } else {
        throw new Error(`unknown resource ${uri}`);
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(payload, null, 2)
            }
          ]
        }
      };
    }

    if (method === 'tools/call') {
      const name = params.name;
      const args = params.arguments ?? {};
      let payload: unknown;
      let statusText: string;
      if (name === 'get_usdc_opportunities') {
        payload = await getFilteredOpportunities(config, parseFilterOpportunitiesArgs(args));
        const count = savingsCatalogueSchema.parse(payload).opportunities.length;
        statusText = `${count} USDC savings opportunities loaded.`;
      } else if (name === 'compare_opportunities') {
        payload = await compareOpportunities(config, parseCompareOpportunitiesArgs(args));
        const count = compareOpportunitiesOutputSchema.parse(payload).comparison.length;
        statusText = `${count} USDC opportunities compared.`;
      } else if (name === 'propose_allocation') {
        payload = await proposeAllocation(config, parseProposeAllocationArgs(args));
        statusText = 'Deterministic USDC allocation preview loaded.';
      } else if (name === 'get_opportunity') {
        payload = await getOpportunity(config, parseArgs(opportunityLookupInputSchema, args));
        statusText = 'USDC opportunity loaded.';
      } else if (name === 'get_metric_packet') {
        payload = await getMetricPacket(config, parseArgs(metricPacketInputSchema, args));
        statusText = 'Metric packet loaded.';
      } else if (name === 'calculate_opportunity_analytics') {
        payload = await calculateOpportunityAnalytics(config, parseArgs(opportunityLookupInputSchema, args));
        statusText = 'Opportunity analytics calculated.';
      } else if (name === 'calculate_rate_metrics') {
        payload = await calculateRateMetrics(config, parseArgs(opportunityLookupInputSchema, args));
        statusText = 'Rate metrics calculated.';
      } else if (name === 'calculate_liquidity_metrics') {
        payload = await calculateLiquidityMetrics(config, parseArgs(opportunityLookupInputSchema, args));
        statusText = 'Liquidity metrics calculated.';
      } else if (name === 'calculate_capacity_metrics') {
        payload = await calculateCapacityMetrics(config, parseArgs(opportunityLookupInputSchema, args));
        statusText = 'Capacity metrics calculated.';
      } else if (name === 'calculate_strategy_exposure') {
        payload = await calculateStrategyExposure(config, parseArgs(opportunityLookupInputSchema, args));
        statusText = 'Strategy exposure calculated.';
      } else if (name === 'screen_opportunities') {
        payload = await screenOpportunities(config, parseArgs(screenOpportunitiesInputSchema, args));
        const count = screenOpportunitiesOutputSchema.parse(payload).included.length;
        statusText = `${count} USDC opportunities passed the screen.`;
      } else if (name === 'rank_opportunities') {
        payload = await rankOpportunities(config, parseArgs(rankOpportunitiesInputSchema, args));
        const count = rankOpportunitiesOutputSchema.parse(payload).ranked.length;
        statusText = `${count} USDC opportunities ranked.`;
      } else if (name === 'calculate_blended_apy') {
        payload = await calculateBlendedApy(config, parseArgs(allocationWeightsInputSchema, args));
        statusText = 'Blended APY calculated.';
      } else if (name === 'calculate_blended_risk') {
        payload = await calculateBlendedRisk(config, parseArgs(allocationWeightsInputSchema, args));
        statusText = 'Blended risk calculated.';
      } else if (name === 'calculate_concentration') {
        payload = await calculateConcentration(config, parseArgs(allocationWeightsInputSchema, args));
        statusText = 'Allocation concentration calculated.';
      } else if (name === 'calculate_rebalance_delta') {
        payload = await calculateRebalanceDelta(config, parseArgs(rebalanceDeltaInputSchema, args));
        statusText = 'Rebalance delta calculated.';
      } else if (name === 'validate_allocation_inputs') {
        payload = await validateAllocationInputs(config, parseArgs(allocationWeightsInputSchema, args));
        statusText = 'Allocation inputs validated.';
      } else if (name === 'get_history_sample_schema') {
        payload = getHistorySampleSchema();
        statusText = 'History sample schema loaded.';
      } else if (name === 'validate_history_samples') {
        payload = validateHistorySamples(args);
        statusText = 'History samples validated.';
      } else if (name === 'summarize_history_quality') {
        payload = summarizeHistoryQuality(args);
        statusText = 'History quality summarized.';
      } else if (name === 'calculate_rate_stability') {
        payload = calculateRateStability(args);
        statusText = 'Rate stability calculated.';
      } else if (name === 'calculate_yield_percentiles') {
        payload = calculateYieldPercentiles(args);
        statusText = 'Yield percentiles calculated.';
      } else if (name === 'calculate_historical_liquidity_risk') {
        payload = calculateHistoricalLiquidityRisk(args);
        statusText = 'Historical liquidity risk calculated.';
      } else if (name === 'detect_history_anomalies') {
        payload = detectHistoryAnomalies(args);
        statusText = 'History anomalies detected.';
      } else if (name === 'compare_historical_opportunities') {
        payload = compareHistoricalOpportunities(parseArgs(historyComparisonInputSchema, args));
        statusText = 'Historical opportunities compared.';
      } else {
        throw new Error(`unknown tool ${String(name)}`);
      }

      return { jsonrpc: '2.0', id, result: toolResult(payload, statusText) };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `method not found: ${String(method)}`
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
