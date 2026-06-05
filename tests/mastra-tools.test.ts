import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSavingsMastraTools } from '../src/mastra/tools/index.js';
import type { SavingsCatalogue } from '../src/types.js';

const fixtureConfig = {
  useFixtureCatalogue: true,
  port: 0
};
const toolContext = {} as never;

function parseResult<T>(value: unknown): T {
  assert.equal(typeof value, 'object');
  return value as T;
}

describe('Savings Mastra tools', () => {
  it('searches canonical USDC opportunities in fixture mode', async () => {
    const tools = createSavingsMastraTools(fixtureConfig);

    const result = parseResult<SavingsCatalogue>(
      await tools.searchUsdcOpportunitiesTool.execute?.({ minTvlUsd: 1_000_000 }, toolContext)
    );

    assert.equal(result.asset.symbol, 'USDC');
    assert.equal(result.opportunities.length >= 2, true);
    assert.equal(result.opportunities.every((opportunity) => opportunity.asset.symbol === 'USDC'), true);
  });

  it('compares selected opportunities through the deterministic library', async () => {
    const tools = createSavingsMastraTools(fixtureConfig);

    const result = parseResult<{ comparison: Array<{ id: string; risk: { score: number } }> }>(
      await tools.compareOpportunitiesTool.execute?.(
        { opportunityIds: ['kamino:lend:main-usdc', 'kamino:earn:usdc-core'] },
        toolContext
      )
    );

    assert.deepEqual(
      result.comparison.map((item) => item.id),
      ['kamino:lend:main-usdc', 'kamino:earn:usdc-core']
    );
  });

  it('proposes deterministic allocation weights without agent choice', async () => {
    const tools = createSavingsMastraTools(fixtureConfig);

    const result = parseResult<{ allocation: { weights: Array<{ weightPct: number }>; rationale: string } }>(
      await tools.proposeAllocationTool.execute?.(
        {
          opportunityIds: ['kamino:lend:main-usdc', 'kamino:earn:usdc-core'],
          amountUsd: 10_000,
          riskPreference: 'balanced'
        },
        toolContext
      )
    );
    const totalWeight = result.allocation.weights.reduce((sum, weight) => sum + weight.weightPct, 0);

    assert.equal(result.allocation.weights.length, 2);
    assert.equal(Math.round(totalWeight), 100);
    assert.equal(result.allocation.rationale.includes('deterministic'), true);
  });

  it('builds a metric packet for a selected opportunity', async () => {
    const tools = createSavingsMastraTools(fixtureConfig);

    const result = parseResult<{ opportunityId: string; rate: { currentApy: number }; liquidity: { withdrawalMode: string } }>(
      await tools.getMetricPacketTool.execute?.({ opportunityId: 'kamino:lend:main-usdc' }, toolContext)
    );

    assert.equal(result.opportunityId, 'kamino:lend:main-usdc');
    assert.equal(result.rate.currentApy, 0.044);
    assert.equal(result.liquidity.withdrawalMode, 'buffer');
  });

  it('reports data quality warnings for fixture-backed opportunities', async () => {
    const tools = createSavingsMastraTools(fixtureConfig);

    const result = parseResult<{ mode: string; warnings: string[]; opportunityReports: Array<{ opportunityId: string }> }>(
      await tools.analyzeDataQualityTool.execute?.({}, toolContext)
    );

    assert.equal(result.mode, 'fixture');
    assert.equal(result.warnings.some((warning) => warning.includes('fixture')), true);
    assert.equal(result.opportunityReports.length, 5);
  });
});
