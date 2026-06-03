import { createStep, createWorkflow } from '@mastra/core/workflows';

import { loadConfig } from '../../config.js';
import type { AppConfig, SavingsCatalogue, SavingsOpportunity } from '../../types.js';
import {
  analyzeCapacityUtilization,
  analyzeExitLiquidity,
  analyzeRateQuality,
  analyzeStrategyExposure,
  decomposeVenueRisk,
  narrateDeterministicAllocation
} from '../agents/metric-specialists.js';
import {
  allocationOutputSchema,
  analyzeSavingsAllocationOutputSchema,
  analyzeSavingsAllocationWorkflowInputSchema,
  dataQualityReportSchema,
  metricPacketSchema,
  savingsCatalogueSchema
} from '../schemas/savings.js';
import type {
  AnalyzeSavingsAllocationInput,
  AnalyzeSavingsAllocationOutput,
  AllocationOutput,
  DataQualityReport,
  EligibilityReport,
  MetricPacket,
  OpportunityAnalysis
} from '../schemas/savings.js';
import { buildDataQualityReport, createSavingsMastraTools } from '../tools/index.js';

function bindConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig(), ...overrides };
}

function eligibilityReasons(opportunity: SavingsOpportunity): string[] {
  const reasons: string[] = [];
  if (!opportunity.flags.depositable) reasons.push('opportunity is not currently depositable');
  if (!opportunity.flags.simulatable) reasons.push('opportunity is not currently simulatable');
  if (opportunity.evidence.length === 0) reasons.push('opportunity has no evidence links');
  if (!Number.isFinite(opportunity.apy.current)) reasons.push('opportunity APY is not finite');
  return reasons;
}

function buildEligibilityReport(opportunities: readonly SavingsOpportunity[], requestedIds: readonly string[]): EligibilityReport {
  const availableIds = new Set(opportunities.map((opportunity) => opportunity.id));
  const ineligible = opportunities
    .map((opportunity) => ({ opportunityId: opportunity.id, reasons: eligibilityReasons(opportunity) }))
    .filter((entry) => entry.reasons.length > 0);
  const missing = requestedIds.filter((id) => !availableIds.has(id));

  for (const opportunityId of missing) {
    ineligible.push({ opportunityId, reasons: ['requested opportunity was not found in the catalogue'] });
  }

  const warnings = ineligible.flatMap((entry) => entry.reasons.map((reason) => `${entry.opportunityId}: ${reason}`));
  const eligibleOpportunityIds = opportunities
    .filter((opportunity) => eligibilityReasons(opportunity).length === 0)
    .map((opportunity) => opportunity.id);

  return {
    status: missing.length > 0 ? 'blocked' : ineligible.length > 0 ? 'warning' : 'ok',
    eligibleOpportunityIds,
    ineligible,
    warnings
  };
}

function orderedSelectedOpportunities(
  opportunities: readonly SavingsOpportunity[],
  requestedIds: readonly string[]
): SavingsOpportunity[] {
  const byId = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]));
  return requestedIds.map((id) => byId.get(id)).filter((opportunity): opportunity is SavingsOpportunity => Boolean(opportunity));
}

function uniqueEvidence(analyses: readonly OpportunityAnalysis[]) {
  const seen = new Set<string>();
  return analyses.flatMap((analysis) =>
    analysis.evidence.filter((evidence) => {
      const key = `${evidence.label}:${evidence.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  );
}

function buildOpportunityAnalysis(metricPacket: MetricPacket): OpportunityAnalysis {
  const rateQuality = analyzeRateQuality(metricPacket);
  const exitLiquidity = analyzeExitLiquidity(metricPacket);
  const capacityUtilization = analyzeCapacityUtilization(metricPacket);
  const strategyExposure = analyzeStrategyExposure(metricPacket);
  const venueRisk = decomposeVenueRisk({
    metricPacket,
    rateQuality,
    exitLiquidity,
    capacityUtilization,
    strategyExposure
  });

  return {
    opportunityId: metricPacket.opportunityId,
    metricPacket,
    rateQuality,
    exitLiquidity,
    capacityUtilization,
    strategyExposure,
    venueRisk,
    evidence: venueRisk.evidence
  };
}

export async function runAnalyzeSavingsAllocation(
  input: AnalyzeSavingsAllocationInput,
  overrides: Partial<AppConfig> = {}
): Promise<AnalyzeSavingsAllocationOutput> {
  const config = bindConfig(overrides);
  const parsedInput = analyzeSavingsAllocationWorkflowInputSchema.parse(input);
  const tools = createSavingsMastraTools(config);
  const toolContext = {} as never;

  const rawCatalogue = await tools.searchUsdcOpportunitiesTool.execute?.({ refresh: parsedInput.refresh }, toolContext);
  if (!rawCatalogue) throw new Error('searchUsdcOpportunitiesTool did not return a catalogue');
  const catalogue = savingsCatalogueSchema.parse(rawCatalogue);
  const domainCatalogue = catalogue as unknown as SavingsCatalogue;

  const selectedOpportunities = orderedSelectedOpportunities(domainCatalogue.opportunities, parsedInput.opportunityIds);
  if (selectedOpportunities.length !== parsedInput.opportunityIds.length) {
    const dataQuality = buildDataQualityReport(domainCatalogue, parsedInput.opportunityIds);
    const eligibility = buildEligibilityReport(selectedOpportunities, parsedInput.opportunityIds);
    throw new Error(`cannot analyze allocation: ${[...dataQuality.warnings, ...eligibility.warnings].join('; ')}`);
  }

  const rawDataQuality = await tools.analyzeDataQualityTool.execute?.(
    { refresh: parsedInput.refresh, opportunityIds: parsedInput.opportunityIds },
    toolContext
  );
  if (!rawDataQuality) throw new Error('analyzeDataQualityTool did not return a report');
  const dataQuality: DataQualityReport = dataQualityReportSchema.parse(rawDataQuality);

  const eligibility = buildEligibilityReport(selectedOpportunities, parsedInput.opportunityIds);

  const rawAllocation = await tools.proposeAllocationTool.execute?.(parsedInput, toolContext);
  if (!rawAllocation) throw new Error('proposeAllocationTool did not return an allocation');
  const allocation: AllocationOutput = allocationOutputSchema.parse(rawAllocation);

  const metricPackets: MetricPacket[] = await Promise.all(
    parsedInput.opportunityIds.map(async (opportunityId) => {
      const packet = await tools.getMetricPacketTool.execute?.(
        { opportunityId, refresh: parsedInput.refresh },
        toolContext
      );
      if (!packet) throw new Error(`getMetricPacketTool did not return a packet for ${opportunityId}`);
      return metricPacketSchema.parse(packet);
    })
  );

  const opportunityAnalyses = metricPackets.map(buildOpportunityAnalysis);
  const strategyNarration = narrateDeterministicAllocation({
    allocation,
    venueRisks: opportunityAnalyses.map((analysis) => analysis.venueRisk)
  });

  return analyzeSavingsAllocationOutputSchema.parse({
    kind: 'savings.allocation.analysis',
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    input: parsedInput,
    asset: catalogue.asset,
    source: catalogue.source,
    selectedOpportunityIds: selectedOpportunities.map((opportunity) => opportunity.id),
    selectedOpportunities,
    eligibility,
    dataQuality,
    allocation,
    metricPackets,
    opportunityAnalyses,
    strategyNarration: {
      ...strategyNarration,
      evidence: uniqueEvidence(opportunityAnalyses)
    },
    boundaries: {
      auth: 'external_integrator',
      signing: 'external_integrator',
      transactionSending: 'external_integrator',
      userLedger: 'external_integrator'
    }
  });
}

export function createAnalyzeSavingsAllocationWorkflow(overrides: Partial<AppConfig> = {}) {
  const analyzeSavingsAllocationStep = createStep({
    id: 'compose-savings-allocation-analysis',
    description: 'Compose Savings MCP tools and metric specialists into one portable allocation-analysis payload.',
    inputSchema: analyzeSavingsAllocationWorkflowInputSchema,
    outputSchema: analyzeSavingsAllocationOutputSchema,
    execute: async ({ inputData }) => runAnalyzeSavingsAllocation(inputData, overrides)
  });

  return createWorkflow({
    id: 'analyzeSavingsAllocationWorkflow',
    description: 'Analyze a deterministic USDC savings allocation with normalized data-quality, metric, risk, and narration outputs.',
    inputSchema: analyzeSavingsAllocationWorkflowInputSchema,
    outputSchema: analyzeSavingsAllocationOutputSchema
  })
    .then(analyzeSavingsAllocationStep)
    .commit();
}

export const analyzeSavingsAllocationWorkflow = createAnalyzeSavingsAllocationWorkflow();
