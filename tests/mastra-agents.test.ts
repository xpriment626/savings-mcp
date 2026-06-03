import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { proposeAllocation } from '../src/allocation.js';
import { loadConfig } from '../src/config.js';
import { fixtureCatalogue } from '../src/fixtures.js';
import {
  analyzeCapacityUtilization,
  analyzeExitLiquidity,
  analyzeRateQuality,
  analyzeStrategyExposure,
  decomposeVenueRisk,
  metricSpecialistAgents,
  narrateDeterministicAllocation
} from '../src/mastra/agents/metric-specialists.js';
import {
  capacityUtilizationAnalysisSchema,
  exitLiquidityAnalysisSchema,
  rateQualityAnalysisSchema,
  strategyExposureAnalysisSchema,
  strategyNarrationSchema,
  venueRiskDecompositionSchema
} from '../src/mastra/schemas/savings.js';
import { buildMetricPacket } from '../src/mastra/tools/index.js';

const generatedAt = '2026-06-03T00:00:00.000Z';
const catalogue = fixtureCatalogue(generatedAt);

function opportunityById(id: string) {
  const opportunity = catalogue.opportunities.find((item) => item.id === id);
  assert.ok(opportunity);
  return opportunity;
}

const mainReserve = opportunityById('kamino:lend:main-usdc');
const earnVault = opportunityById('kamino:earn:usdc-core');
const isolatedReserve = opportunityById('kamino:lend:alt-usdc');

function evidenceUrls(output: { evidence: Array<{ url: string }> }): string[] {
  return output.evidence.map((item) => item.url);
}

describe('Savings Mastra metric-specialist agents', () => {
  it('exports six named Mastra agents with zod structured output schemas', () => {
    const expectedNames = [
      'RateQualityAgent',
      'ExitLiquidityAgent',
      'CapacityUtilizationAgent',
      'StrategyExposureAgent',
      'VenueRiskDecomposerAgent',
      'StrategyNarratorAgent'
    ];

    for (const name of expectedNames) {
      const agent = metricSpecialistAgents[name as keyof typeof metricSpecialistAgents];
      assert.equal(agent.id.length > 0, true);
      assert.equal(typeof agent.generate, 'function');
      assert.equal(typeof agent.outputSchema.parse, 'function');
    }
  });

  it('RateQualityAgent produces concise evidence-linked APY quality output', () => {
    const packet = buildMetricPacket(mainReserve);

    const output = rateQualityAnalysisSchema.parse(analyzeRateQuality(packet));

    assert.equal(output.opportunityId, 'kamino:lend:main-usdc');
    assert.equal(output.apySource, 'fixture');
    assert.equal(output.apyWindow, 'current_supply_apy');
    assert.equal(output.missingHistory, true);
    assert.equal(output.stabilityConfidence, 'medium');
    assert.equal(output.summary.length < 240, true);
    assert.deepEqual(evidenceUrls(output), ['https://api.kamino.finance/v2/kamino-market']);
  });

  it('ExitLiquidityAgent classifies utilization, buffer, and exit risks', () => {
    const packet = buildMetricPacket(isolatedReserve);

    const output = exitLiquidityAnalysisSchema.parse(analyzeExitLiquidity(packet));

    assert.equal(output.opportunityId, 'kamino:lend:alt-usdc');
    assert.equal(output.withdrawalMode, 'buffer');
    assert.equal(output.utilizationPct, 92);
    assert.equal(output.exitRiskLevel, 'high');
    assert.equal(output.risks.some((risk) => risk.includes('high utilization')), true);
    assert.equal(output.evidence.length, 1);
  });

  it('CapacityUtilizationAgent flags thin or non-depositable venues', () => {
    const packet = buildMetricPacket(isolatedReserve);

    const output = capacityUtilizationAnalysisSchema.parse(analyzeCapacityUtilization(packet));

    assert.equal(output.opportunityId, 'kamino:lend:alt-usdc');
    assert.equal(output.tvlUsd, 4_200_000);
    assert.equal(output.depositable, false);
    assert.equal(output.capacitySignals.thinVenue, true);
    assert.equal(output.capacitySignals.highUtilization, true);
    assert.equal(output.warnings.includes('opportunity is not currently depositable'), true);
  });

  it('StrategyExposureAgent separates vault/external strategy exposure from reserve exposure', () => {
    const packet = buildMetricPacket(earnVault);

    const output = strategyExposureAnalysisSchema.parse(analyzeStrategyExposure(packet));

    assert.equal(output.opportunityId, 'kamino:earn:usdc-core');
    assert.equal(output.productType, 'vault');
    assert.equal(output.usesExternalStrategies, true);
    assert.equal(output.exposureFlags.includes('managed_vault'), true);
    assert.equal(output.routingNotes.some((note) => note.includes('Kamino Earn')), true);
  });

  it('VenueRiskDecomposerAgent synthesizes specialist outputs into comparable venue risk', () => {
    const packet = buildMetricPacket(isolatedReserve);
    const rateQuality = analyzeRateQuality(packet);
    const exitLiquidity = analyzeExitLiquidity(packet);
    const capacityUtilization = analyzeCapacityUtilization(packet);
    const strategyExposure = analyzeStrategyExposure(packet);

    const output = venueRiskDecompositionSchema.parse(
      decomposeVenueRisk({
        metricPacket: packet,
        rateQuality,
        exitLiquidity,
        capacityUtilization,
        strategyExposure
      })
    );

    assert.equal(output.opportunityId, 'kamino:lend:alt-usdc');
    assert.equal(output.venue, 'Kamino');
    assert.equal(output.comparableRiskTier, 'elevated');
    assert.equal(output.components.exitLiquidity, 'high');
    assert.equal(output.warnings.some((warning) => warning.includes('exit liquidity')), true);
  });

  it('StrategyNarratorAgent narrates deterministic allocation without changing weights', async () => {
    const config = { ...loadConfig(), useFixtureCatalogue: true, port: 0 };
    const allocation = await proposeAllocation(config, {
      opportunityIds: ['kamino:lend:main-usdc', 'kamino:earn:usdc-core'],
      amountUsd: 10_000,
      riskPreference: 'balanced'
    });
    const metricPackets = [mainReserve, earnVault].map(buildMetricPacket);
    const venueRisks = metricPackets.map((packet) =>
      decomposeVenueRisk({
        metricPacket: packet,
        rateQuality: analyzeRateQuality(packet),
        exitLiquidity: analyzeExitLiquidity(packet),
        capacityUtilization: analyzeCapacityUtilization(packet),
        strategyExposure: analyzeStrategyExposure(packet)
      })
    );

    const output = strategyNarrationSchema.parse(narrateDeterministicAllocation({ allocation, venueRisks }));

    assert.equal(output.allocationUnchanged, true);
    assert.deepEqual(
      output.weights.map((weight) => [weight.opportunityId, weight.weightPct]),
      allocation.allocation.weights.map((weight) => [weight.opportunityId, weight.weightPct])
    );
    assert.equal(output.nonResponsibilities.includes('does not choose or modify allocation weights'), true);
    assert.equal(output.evidence.length >= 2, true);
  });
});
