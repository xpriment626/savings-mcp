import { createStep, createWorkflow } from '@mastra/core/workflows';

import { buildOpportunityAnalysis, narrateDeterministicAllocation, uniqueOpportunityAnalysisEvidence } from '../../../../src/core/analysis.js';
import { buildEligibilityReport, buildMetricPacket, orderedSelectedOpportunities } from '../../../../src/core/metrics.js';
import { loadConfig } from '../../../../src/config.js';
import type { AppConfig } from '../../../../src/types.js';
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
  MetricPacket
} from '../schemas/savings.js';
import { createSavingsMastraTools } from '../tools/index.js';

function bindConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig(), ...overrides };
}

const externalIntegratorBoundaries = {
  auth: 'external_integrator',
  signing: 'external_integrator',
  transactionSending: 'external_integrator',
  userLedger: 'external_integrator'
} as const;

function blockIfAllocationCannotRun(
  eligibility: EligibilityReport,
  selectedOpportunityCount: number
): EligibilityReport {
  if (selectedOpportunityCount >= 2) return eligibility;

  return {
    ...eligibility,
    status: 'blocked',
    warnings: [
      ...eligibility.warnings,
      'at least 2 selected opportunities are required for deterministic allocation'
    ]
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

  const selectedOpportunities = orderedSelectedOpportunities(catalogue.opportunities, parsedInput.opportunityIds);

  const rawDataQuality = await tools.analyzeDataQualityTool.execute?.(
    { refresh: parsedInput.refresh, opportunityIds: parsedInput.opportunityIds },
    toolContext
  );
  if (!rawDataQuality) throw new Error('analyzeDataQualityTool did not return a report');
  const dataQuality: DataQualityReport = dataQualityReportSchema.parse(rawDataQuality);

  const eligibility = blockIfAllocationCannotRun(
    buildEligibilityReport(selectedOpportunities, parsedInput.opportunityIds),
    selectedOpportunities.length
  );

  if (eligibility.status === 'blocked') {
    const metricPackets = selectedOpportunities.map(buildMetricPacket);
    const opportunityAnalyses = metricPackets.map(buildOpportunityAnalysis);

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
      allocation: null,
      metricPackets,
      opportunityAnalyses,
      strategyNarration: null,
      boundaries: externalIntegratorBoundaries
    });
  }

  const rawAllocation = await tools.proposeAllocationTool.execute?.(parsedInput, toolContext);
  if (!rawAllocation) throw new Error('proposeAllocationTool did not return an allocation');
  const allocation: AllocationOutput = allocationOutputSchema.parse(rawAllocation);

  const metricPackets: MetricPacket[] = await Promise.all(
    selectedOpportunities.map(async (opportunity) => {
      const packet = await tools.getMetricPacketTool.execute?.(
        { opportunityId: opportunity.id, refresh: parsedInput.refresh },
        toolContext
      );
      if (!packet) throw new Error(`getMetricPacketTool did not return a packet for ${opportunity.id}`);
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
      evidence: uniqueOpportunityAnalysisEvidence(opportunityAnalyses)
    },
    boundaries: externalIntegratorBoundaries
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
