import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateBlendedApy,
  calculateBlendedRisk,
  calculateConcentration,
  calculateOpportunityAnalytics,
  calculateRebalanceDelta,
  rankOpportunities,
  screenOpportunities,
  validateAllocationInputs
} from '../src/current-analytics.js';
import { loadConfig } from '../src/config.js';

const fixtureConfig = { ...loadConfig(), useFixtureCatalogue: true, port: 0 };

describe('current-snapshot analytics primitives', () => {
  it('returns decomposed metric primitives for a selected opportunity', async () => {
    const result = await calculateOpportunityAnalytics(fixtureConfig, { opportunityId: 'kamino:earn:usdc-core' });

    assert.equal(result.opportunity.id, 'kamino:earn:usdc-core');
    assert.equal(result.metricPacket.opportunityId, 'kamino:earn:usdc-core');
    assert.equal(result.rateMetrics.currentApy, 0.061);
    assert.equal(result.liquidityMetrics.withdrawalMode, 'unknown');
    assert.equal(result.capacityMetrics.depositTxKnown, false);
    assert.equal(result.strategyExposure.exposureFlags.includes('managed_vault'), true);
  });

  it('screens and ranks opportunities without hiding market-data-only entries', async () => {
    const screened = await screenOpportunities(fixtureConfig, {
      minTvlUsd: 1_000_000,
      integrationStatuses: ['market_data_only', 'tx_blueprint_known']
    });
    const ranked = await rankOpportunities(fixtureConfig, {
      opportunityIds: screened.included.map((entry) => entry.id),
      rankBy: 'risk_adjusted_apy'
    });

    assert.equal(screened.included.some((entry) => entry.integrationStatus === 'market_data_only'), true);
    assert.equal(screened.excluded.every((entry) => entry.reasons.length > 0), true);
    assert.equal(ranked.ranked.length, screened.included.length);
    assert.equal(ranked.ranked.every((entry) => Number.isFinite(entry.rankScore)), true);
  });

  it('calculates allocation primitives from caller-supplied weights', async () => {
    const weights = [
      { opportunityId: 'kamino:lend:main-usdc', weightPct: 50 },
      { opportunityId: 'jupiter:earn:usdc', weightPct: 30 },
      { opportunityId: 'save:lend:main-usdc', weightPct: 20 }
    ];

    const validation = await validateAllocationInputs(fixtureConfig, { weights, amountUsd: 10_000 });
    const blendedApy = await calculateBlendedApy(fixtureConfig, { weights });
    const blendedRisk = await calculateBlendedRisk(fixtureConfig, { weights });
    const concentration = await calculateConcentration(fixtureConfig, { weights });
    const rebalance = await calculateRebalanceDelta(fixtureConfig, {
      amountUsd: 10_000,
      currentWeights: [
        { opportunityId: 'kamino:lend:main-usdc', weightPct: 60 },
        { opportunityId: 'jupiter:earn:usdc', weightPct: 20 },
        { opportunityId: 'save:lend:main-usdc', weightPct: 20 }
      ],
      targetWeights: weights
    });

    assert.equal(validation.status, 'ok');
    assert.equal(Math.round(blendedApy.blendedApyPct * 100) / 100, 3.8);
    assert.equal(Number.isFinite(blendedRisk.blendedRiskScore), true);
    assert.equal(concentration.byVenue[0]?.venue, 'Kamino');
    assert.equal(concentration.maxVenueWeightPct, 50);
    assert.equal(rebalance.deltas.find((delta) => delta.opportunityId === 'jupiter:earn:usdc')?.deltaWeightPct, 10);
  });
});
