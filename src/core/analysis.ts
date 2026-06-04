import {
  capacityUtilizationAnalysisSchema,
  exitLiquidityAnalysisSchema,
  rateQualityAnalysisSchema,
  strategyExposureAnalysisSchema,
  strategyNarrationSchema,
  venueRiskDecompositionSchema
} from './schemas.js';
import type {
  AllocationOutput,
  CapacityUtilizationAnalysis,
  ExitLiquidityAnalysis,
  MetricPacket,
  OpportunityAnalysis,
  RateQualityAnalysis,
  StrategyExposureAnalysis,
  StrategyNarration,
  VenueRiskDecomposition
} from './schemas.js';

type ExposureFlag = StrategyExposureAnalysis['exposureFlags'][number];

function uniqueEvidence(...evidenceLists: Array<MetricPacket['evidence']>): MetricPacket['evidence'] {
  const seen = new Set<string>();
  const output: MetricPacket['evidence'] = [];
  for (const evidenceList of evidenceLists) {
    for (const evidence of evidenceList) {
      const key = `${evidence.label}:${evidence.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(evidence);
    }
  }
  return output;
}

function shortSummary(value: string): string {
  return value.length <= 220 ? value : `${value.slice(0, 217)}...`;
}

export function analyzeRateQuality(packet: MetricPacket): RateQualityAnalysis {
  const missingHistory = packet.rate.source === 'fixture' || !/\d+d|history/i.test(packet.rate.window);
  const warnings: string[] = [];
  if (missingHistory) warnings.push('historical APY series is missing or fixture-backed');
  if (packet.rate.rewardsApy === undefined) warnings.push('reward APY is not separately normalized');

  const stabilityConfidence: RateQualityAnalysis['stabilityConfidence'] =
    packet.productType === 'vault' || missingHistory ? 'medium' : 'high';

  return rateQualityAnalysisSchema.parse({
    opportunityId: packet.opportunityId,
    summary: shortSummary(`${packet.venue} APY is sourced from ${packet.rate.source} over ${packet.rate.window}.`),
    apySource: packet.rate.source,
    apyWindow: packet.rate.window,
    currentApy: packet.rate.currentApy,
    baseApy: packet.rate.baseApy ?? packet.rate.currentApy,
    rewardsApy: packet.rate.rewardsApy ?? 0,
    missingHistory,
    stabilityConfidence,
    warnings,
    evidence: packet.evidence
  });
}

export function analyzeExitLiquidity(packet: MetricPacket): ExitLiquidityAnalysis {
  const risks: string[] = [];
  const utilization = packet.liquidity.utilizationPct;
  const buffer = packet.liquidity.withdrawalBufferPct;

  if (utilization !== null && utilization >= 90) risks.push('high utilization can slow exits');
  if (buffer !== null && buffer <= 10) risks.push('low withdrawal buffer can constrain redemptions');
  if (packet.liquidity.withdrawalMode === 'unknown') risks.push('withdrawal path is not fully normalized');
  if (packet.liquidity.withdrawalMode === 'lp_exit') risks.push('LP exit may include price impact or pool imbalance');

  const exitRiskLevel: ExitLiquidityAnalysis['exitRiskLevel'] =
    risks.length > 1 || (utilization !== null && utilization >= 90)
      ? 'high'
      : utilization !== null && utilization >= 75
        ? 'medium'
        : packet.liquidity.withdrawalMode === 'unknown'
          ? 'medium'
          : 'low';

  return exitLiquidityAnalysisSchema.parse({
    opportunityId: packet.opportunityId,
    summary: shortSummary(
      `${packet.venue} exit liquidity uses ${packet.liquidity.withdrawalMode} mode with utilization ${
        utilization ?? 'unknown'
      }.`
    ),
    withdrawalMode: packet.liquidity.withdrawalMode,
    utilizationPct: utilization,
    withdrawalBufferPct: buffer,
    debtCeilingNote:
      packet.liquidity.withdrawalMode === 'debt_ceiling'
        ? 'withdrawals depend on debt ceiling expansion mechanics'
        : 'no debt-ceiling withdrawal mode detected',
    lpExitNote:
      packet.liquidity.withdrawalMode === 'lp_exit'
        ? 'LP unwind path may expose exits to pool depth and imbalance'
        : 'no LP exit mode detected',
    exitRiskLevel,
    risks,
    evidence: packet.evidence
  });
}

export function analyzeCapacityUtilization(packet: MetricPacket): CapacityUtilizationAnalysis {
  const utilization = packet.liquidity.utilizationPct;
  const thinVenue = packet.scale.tvlUsd < 10_000_000;
  const highUtilization = utilization !== null && utilization >= 85;
  const cappedOrUnavailable = !packet.flags.depositable || !packet.flags.simulatable;
  const fragmentedLiquidity = packet.scale.tvlUsd < 25_000_000 || packet.productType === 'vault';

  const warnings: string[] = [];
  if (thinVenue) warnings.push('venue capacity is thin for large USDC deposits');
  if (highUtilization) warnings.push('high utilization reduces available exit liquidity');
  if (!packet.flags.depositable) warnings.push('opportunity is not currently depositable');
  if (!packet.flags.simulatable) warnings.push('opportunity is not currently simulatable');

  return capacityUtilizationAnalysisSchema.parse({
    opportunityId: packet.opportunityId,
    summary: shortSummary(`${packet.venue} capacity is ${packet.scale.tvlUsd} TVL with depositable=${packet.flags.depositable}.`),
    tvlUsd: packet.scale.tvlUsd,
    utilizationPct: utilization,
    depositable: packet.flags.depositable,
    simulatable: packet.flags.simulatable,
    capacitySignals: {
      thinVenue,
      highUtilization,
      cappedOrUnavailable,
      fragmentedLiquidity
    },
    warnings,
    evidence: packet.evidence
  });
}

export function analyzeStrategyExposure(packet: MetricPacket): StrategyExposureAnalysis {
  const exposureFlags: ExposureFlag[] = [];
  const routingNotes: string[] = [];
  const warnings: string[] = [];

  if (packet.productType === 'lending_reserve') exposureFlags.push('simple_reserve');
  if (packet.productType === 'vault') exposureFlags.push('managed_vault');
  if (packet.flags.usesExternalStrategies) exposureFlags.push('external_strategy');
  if (packet.flags.hasLpExposure) exposureFlags.push('lp_exposure');

  if (packet.venue.toLowerCase() === 'kamino' && packet.productType === 'vault') {
    routingNotes.push('Kamino Earn vault routing depends on curator allocation across underlying reserves');
  }
  if (packet.venue.toLowerCase() === 'meteora' || packet.flags.hasLpExposure) {
    routingNotes.push('Meteora-style LP routing should be treated as strategy exposure, not plain lending');
  }
  if (packet.productType === 'vault') warnings.push('managed vault allocations require curator and underlying-reserve review');
  if (packet.flags.hasLpExposure) warnings.push('LP exposure can introduce impermanent loss or pool imbalance risk');

  return strategyExposureAnalysisSchema.parse({
    opportunityId: packet.opportunityId,
    summary: shortSummary(`${packet.venue} ${packet.productType} exposure flags: ${exposureFlags.join(', ')}.`),
    productType: packet.productType,
    usesExternalStrategies: packet.flags.usesExternalStrategies,
    hasLpExposure: packet.flags.hasLpExposure,
    exposureFlags,
    routingNotes,
    warnings,
    evidence: packet.evidence
  });
}

function capacityRiskLevel(analysis: CapacityUtilizationAnalysis): VenueRiskDecomposition['components']['capacity'] {
  if (analysis.capacitySignals.highUtilization || analysis.capacitySignals.cappedOrUnavailable) return 'high';
  if (analysis.capacitySignals.thinVenue || analysis.capacitySignals.fragmentedLiquidity) return 'medium';
  return 'low';
}

function strategyRiskLevel(analysis: StrategyExposureAnalysis): VenueRiskDecomposition['components']['strategyExposure'] {
  if (analysis.hasLpExposure) return 'high';
  if (analysis.usesExternalStrategies || analysis.productType === 'vault') return 'medium';
  return 'low';
}

export function decomposeVenueRisk(input: {
  metricPacket: MetricPacket;
  rateQuality: RateQualityAnalysis;
  exitLiquidity: ExitLiquidityAnalysis;
  capacityUtilization: CapacityUtilizationAnalysis;
  strategyExposure: StrategyExposureAnalysis;
}): VenueRiskDecomposition {
  const warnings = [
    ...input.rateQuality.warnings,
    ...input.exitLiquidity.risks.map((risk) => `exit liquidity: ${risk}`),
    ...input.capacityUtilization.warnings,
    ...input.strategyExposure.warnings
  ];

  return venueRiskDecompositionSchema.parse({
    opportunityId: input.metricPacket.opportunityId,
    venue: input.metricPacket.venue,
    protocol: input.metricPacket.protocol,
    productType: input.metricPacket.productType,
    comparableRiskTier: input.metricPacket.riskInputs.tier,
    riskScore: input.metricPacket.riskInputs.score,
    summary: shortSummary(`${input.metricPacket.opportunityId} risk is ${input.metricPacket.riskInputs.tier}.`),
    components: {
      rateQuality: input.rateQuality.stabilityConfidence,
      exitLiquidity: input.exitLiquidity.exitRiskLevel,
      capacity: capacityRiskLevel(input.capacityUtilization),
      strategyExposure: strategyRiskLevel(input.strategyExposure)
    },
    warnings,
    evidence: uniqueEvidence(
      input.rateQuality.evidence,
      input.exitLiquidity.evidence,
      input.capacityUtilization.evidence,
      input.strategyExposure.evidence
    )
  });
}

export function narrateDeterministicAllocation(input: {
  allocation: AllocationOutput;
  venueRisks: readonly VenueRiskDecomposition[];
}): StrategyNarration {
  return strategyNarrationSchema.parse({
    summary: shortSummary(`${input.allocation.allocation.riskEnvelope}; weights are deterministic and unchanged.`),
    allocationUnchanged: true,
    riskEnvelope: input.allocation.allocation.riskEnvelope,
    blendedApyPct: input.allocation.allocation.blendedApyPct,
    blendedRiskScore: input.allocation.allocation.blendedRiskScore,
    weights: input.allocation.allocation.weights,
    narration:
      'This narration explains the deterministic allocation result and specialist risk context; it does not alter selected venues or weights.',
    nonResponsibilities: [
      'does not choose or modify allocation weights',
      'does not construct transactions',
      'does not sign or send transactions',
      'does not persist user ledgers'
    ],
    evidence: uniqueEvidence(...input.venueRisks.map((risk) => risk.evidence))
  });
}

export function buildOpportunityAnalysis(metricPacket: MetricPacket): OpportunityAnalysis {
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

export function uniqueOpportunityAnalysisEvidence(analyses: readonly OpportunityAnalysis[]): MetricPacket['evidence'] {
  return uniqueEvidence(...analyses.map((analysis) => analysis.evidence));
}
