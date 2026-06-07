import { Agent } from '@mastra/core/agent';
import type { z } from 'zod';

import {
  capacityUtilizationAnalysisSchema,
  exitLiquidityAnalysisSchema,
  rateQualityAnalysisSchema,
  strategyExposureAnalysisSchema,
  strategyNarrationSchema,
  venueRiskDecompositionSchema
} from '../schemas/savings.js';

type StructuredMetricAgent<TSchema extends z.ZodType> = Agent & {
  outputSchema: TSchema;
};

const DEFAULT_MODEL = 'openai/gpt-5-mini';

function createStructuredAgent<TSchema extends z.ZodType>(input: {
  id: string;
  name: string;
  instructions: string;
  outputSchema: TSchema;
}): StructuredMetricAgent<TSchema> {
  return Object.assign(
    new Agent({
      id: input.id,
      name: input.name,
      instructions: input.instructions,
      model: DEFAULT_MODEL
    }),
    { outputSchema: input.outputSchema }
  );
}

const commonBoundary = `
Consume only normalized Savings MCP payloads supplied in the prompt.
Do not fetch raw protocol data, choose allocation weights, construct transactions, persist user state, sign, or send.
Return concise, evidence-linked, machine-readable structured output only.
`;

export const RateQualityAgent = createStructuredAgent({
  id: 'rate-quality-agent',
  name: 'RateQualityAgent',
  instructions: `${commonBoundary}
Analyze APY quality: source, window, base versus reward yield, history gaps, and stability confidence.`,
  outputSchema: rateQualityAnalysisSchema
});

export const ExitLiquidityAgent = createStructuredAgent({
  id: 'exit-liquidity-agent',
  name: 'ExitLiquidityAgent',
  instructions: `${commonBoundary}
Analyze withdrawal mode, utilization, withdrawal buffers, debt-ceiling mechanics, LP exit paths, and exit risks.`,
  outputSchema: exitLiquidityAnalysisSchema
});

export const CapacityUtilizationAgent = createStructuredAgent({
  id: 'capacity-utilization-agent',
  name: 'CapacityUtilizationAgent',
  instructions: `${commonBoundary}
Analyze TVL, utilization, connector capability limits, and thin or fragmented venue capacity warnings.`,
  outputSchema: capacityUtilizationAnalysisSchema
});

export const StrategyExposureAgent = createStructuredAgent({
  id: 'strategy-exposure-agent',
  name: 'StrategyExposureAgent',
  instructions: `${commonBoundary}
Analyze managed vault exposure, external strategy routing, Kamino Earn or Meteora routing notes, and LP exposure flags.`,
  outputSchema: strategyExposureAnalysisSchema
});

export const VenueRiskDecomposerAgent = createStructuredAgent({
  id: 'venue-risk-decomposer-agent',
  name: 'VenueRiskDecomposerAgent',
  instructions: `${commonBoundary}
Synthesize specialist outputs into comparable venue and product risk without changing deterministic scores or weights.`,
  outputSchema: venueRiskDecompositionSchema
});

export const StrategyNarratorAgent = createStructuredAgent({
  id: 'strategy-narrator-agent',
  name: 'StrategyNarratorAgent',
  instructions: `${commonBoundary}
Narrate fixed deterministic allocation outputs. Never change weights, selected venues, or deterministic allocation math.`,
  outputSchema: strategyNarrationSchema
});

export const metricSpecialistAgents = {
  RateQualityAgent,
  ExitLiquidityAgent,
  CapacityUtilizationAgent,
  StrategyExposureAgent,
  VenueRiskDecomposerAgent,
  StrategyNarratorAgent
};

export {
  analyzeCapacityUtilization,
  analyzeExitLiquidity,
  analyzeRateQuality,
  analyzeStrategyExposure,
  buildOpportunityAnalysis,
  decomposeVenueRisk,
  narrateDeterministicAllocation,
  uniqueOpportunityAnalysisEvidence
} from '../../../../src/core/analysis.js';
