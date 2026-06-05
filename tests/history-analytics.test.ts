import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateHistoricalLiquidityRisk,
  calculateRateStability,
  calculateYieldPercentiles,
  compareHistoricalOpportunities,
  detectHistoryAnomalies,
  getHistorySampleSchema,
  summarizeHistoryQuality,
  validateHistorySamples
} from '../src/history-analytics.js';

const mainSamples = [
  { opportunityId: 'kamino:lend:main-usdc', timestamp: '2026-06-01T00:00:00.000Z', apy: 0.04, tvlUsd: 160_000_000, utilizationPct: 70, withdrawalBufferPct: 30, source: 'integrator' },
  { opportunityId: 'kamino:lend:main-usdc', timestamp: '2026-06-02T00:00:00.000Z', apy: 0.041, tvlUsd: 162_000_000, utilizationPct: 71, withdrawalBufferPct: 29, source: 'integrator' },
  { opportunityId: 'kamino:lend:main-usdc', timestamp: '2026-06-03T00:00:00.000Z', apy: 0.039, tvlUsd: 161_000_000, utilizationPct: 72, withdrawalBufferPct: 28, source: 'integrator' },
  { opportunityId: 'kamino:lend:main-usdc', timestamp: '2026-06-04T00:00:00.000Z', apy: 0.042, tvlUsd: 163_000_000, utilizationPct: 73, withdrawalBufferPct: 27, source: 'integrator' },
  { opportunityId: 'kamino:lend:main-usdc', timestamp: '2026-06-05T00:00:00.000Z', apy: 0.041, tvlUsd: 164_000_000, utilizationPct: 74, withdrawalBufferPct: 26, source: 'integrator' }
];

const volatileSamples = [
  { opportunityId: 'jupiter:earn:usdc', timestamp: '2026-06-01T00:00:00.000Z', apy: 0.03, tvlUsd: 400_000_000, withdrawalBufferPct: 35, source: 'integrator' },
  { opportunityId: 'jupiter:earn:usdc', timestamp: '2026-06-02T00:00:00.000Z', apy: 0.035, tvlUsd: 390_000_000, withdrawalBufferPct: 28, source: 'integrator' },
  { opportunityId: 'jupiter:earn:usdc', timestamp: '2026-06-03T00:00:00.000Z', apy: 0.12, tvlUsd: 260_000_000, withdrawalBufferPct: 5, source: 'integrator' },
  { opportunityId: 'jupiter:earn:usdc', timestamp: '2026-06-04T00:00:00.000Z', apy: 0.034, tvlUsd: 275_000_000, withdrawalBufferPct: 12, source: 'integrator' }
];

describe('stateless historical analytics primitives', () => {
  it('exposes and validates the BYOD history sample schema', () => {
    const schema = getHistorySampleSchema();
    const report = validateHistorySamples({ samples: mainSamples });

    assert.equal(schema.sample.required.includes('opportunityId'), true);
    assert.equal(report.status, 'ok');
    assert.equal(report.sampleCount, mainSamples.length);
    assert.deepEqual(report.opportunityIds, ['kamino:lend:main-usdc']);
    assert.equal(report.warnings.length, 0);
  });

  it('summarizes quality and rate stability from raw samples', () => {
    const quality = summarizeHistoryQuality({ samples: mainSamples });
    const stability = calculateRateStability({ samples: mainSamples });
    const percentiles = calculateYieldPercentiles({ samples: mainSamples });

    assert.equal(quality.mode, 'samples');
    assert.equal(quality.coverage.sampleCount, mainSamples.length);
    assert.equal(stability.opportunityId, 'kamino:lend:main-usdc');
    assert.equal(stability.regime, 'stable');
    assert.equal(stability.meanApy > 0.04, true);
    assert.equal(percentiles.p50Apy, 0.041);
    assert.equal(percentiles.p90Apy >= percentiles.p50Apy, true);
  });

  it('accepts precomputed summaries for large integrator history stores', () => {
    const stability = calculateRateStability({
      summary: {
        opportunityId: 'save:lend:main-usdc',
        sampleCount: 720,
        windowDays: 30,
        apyMean: 0.022,
        apyStdDev: 0.003,
        apyMin: 0.018,
        apyMax: 0.028,
        apyP10: 0.019,
        apyP50: 0.022,
        apyP90: 0.026,
        tvlMeanUsd: 30_000_000,
        utilizationMeanPct: 60,
        withdrawalBufferMinPct: 25,
        source: 'integrator_summary'
      }
    });

    assert.equal(stability.mode, 'summary');
    assert.equal(stability.sampleCount, 720);
    assert.equal(stability.regime, 'stable');
  });

  it('detects history anomalies and compares opportunities without persistence', () => {
    const liquidity = calculateHistoricalLiquidityRisk({ samples: volatileSamples });
    const anomalies = detectHistoryAnomalies({ samples: volatileSamples });
    const comparison = compareHistoricalOpportunities({
      histories: [{ samples: mainSamples }, { samples: volatileSamples }]
    });

    assert.equal(liquidity.riskLevel, 'high');
    assert.equal(anomalies.anomalies.some((item) => item.type === 'apy_spike'), true);
    assert.equal(anomalies.anomalies.some((item) => item.type === 'tvl_drop'), true);
    assert.equal(comparison.comparison.length, 2);
    assert.equal(comparison.comparison[0]?.opportunityId, 'kamino:lend:main-usdc');
  });
});
