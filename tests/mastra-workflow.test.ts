import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSavingsMastraMcpServer, createSavingsMastraMcpSurface } from '../src/mastra/mcp-server.js';
import {
  analyzeSavingsAllocationOutputSchema,
  analyzeSavingsAllocationWorkflowInputSchema
} from '../src/mastra/schemas/savings.js';
import {
  analyzeSavingsAllocationWorkflow,
  createAnalyzeSavingsAllocationWorkflow,
  runAnalyzeSavingsAllocation
} from '../src/mastra/workflows/analyze-savings-allocation.js';

const fixtureConfig = {
  useFixtureCatalogue: true,
  port: 0
};

const workflowInput = {
  opportunityIds: ['kamino:lend:main-usdc', 'kamino:earn:usdc-core'],
  amountUsd: 10_000,
  riskPreference: 'balanced' as const
};

describe('analyzeSavingsAllocationWorkflow', () => {
  it('returns a portable structured allocation-analysis payload', async () => {
    const output = analyzeSavingsAllocationOutputSchema.parse(await runAnalyzeSavingsAllocation(workflowInput, fixtureConfig));

    assert.equal(output.kind, 'savings.allocation.analysis');
    assert.equal(output.version, '0.1.0');
    assert.equal(output.input.amountUsd, 10_000);
    assert.deepEqual(output.selectedOpportunityIds, workflowInput.opportunityIds);
    assert.equal(output.selectedOpportunities.length, 2);
    assert.equal(output.metricPackets.length, 2);
    assert.equal(output.opportunityAnalyses.length, 2);
    assert.ok(output.allocation);
    assert.ok(output.strategyNarration);
    assert.equal(output.allocation.allocation.weights.length, 2);
    assert.equal(output.strategyNarration.allocationUnchanged, true);
    assert.equal(output.boundaries.auth, 'external_integrator');
    assert.equal(output.boundaries.signing, 'external_integrator');
    assert.equal(output.boundaries.userLedger, 'external_integrator');
    assert.equal(output.opportunityAnalyses.every((analysis) => analysis.evidence.length > 0), true);
  });

  it('allocates across selected market-data-only opportunities instead of treating them as ineligible', async () => {
    const input = {
      opportunityIds: ['kamino:lend:main-usdc', 'kamino:earn:usdc-core', 'jupiter:earn:usdc'],
      amountUsd: 10_000,
      riskPreference: 'balanced' as const
    };

    const output = analyzeSavingsAllocationOutputSchema.parse(await runAnalyzeSavingsAllocation(input, fixtureConfig));

    assert.equal(output.eligibility.status, 'ok');
    assert.deepEqual(output.eligibility.ineligible, []);
    assert.ok(output.allocation);
    assert.deepEqual(
      new Set(output.allocation.allocation.weights.map((weight) => weight.opportunityId)),
      new Set(input.opportunityIds)
    );
    assert.equal(output.selectedOpportunities.some((opportunity) => opportunity.integrationStatus === 'market_data_only'), true);
  });

  it('returns a structured blocked payload when requested opportunities are unavailable', async () => {
    const input = {
      opportunityIds: ['missing-a', 'missing-b'],
      amountUsd: 10_000,
      riskPreference: 'balanced' as const
    };

    const output = analyzeSavingsAllocationOutputSchema.parse(await runAnalyzeSavingsAllocation(input, fixtureConfig));

    assert.equal(output.kind, 'savings.allocation.analysis');
    assert.equal(output.eligibility.status, 'blocked');
    assert.deepEqual(
      output.eligibility.ineligible.map((entry) => entry.opportunityId),
      ['missing-a', 'missing-b']
    );
    assert.deepEqual(output.selectedOpportunityIds, []);
    assert.equal(output.allocation, null);
    assert.deepEqual(output.metricPackets, []);
    assert.deepEqual(output.opportunityAnalyses, []);
    assert.equal(output.strategyNarration, null);
    assert.equal(output.boundaries.transactionSending, 'external_integrator');
  });

  it('executes through the committed Mastra workflow run API', async () => {
    analyzeSavingsAllocationWorkflowInputSchema.parse(workflowInput);

    assert.equal(analyzeSavingsAllocationWorkflow.id, 'analyzeSavingsAllocationWorkflow');
    const workflow = createAnalyzeSavingsAllocationWorkflow(fixtureConfig);
    const run = await workflow.createRun();
    const result = await run.start({ inputData: workflowInput });

    assert.equal(result.status, 'success');
    assert.equal(result.result.kind, 'savings.allocation.analysis');
    assert.ok(result.result.strategyNarration);
    assert.equal(result.result.strategyNarration.allocationUnchanged, true);
  });

  it('exposes the workflow through the parallel Mastra MCPServer surface', () => {
    const server = createSavingsMastraMcpServer(fixtureConfig);
    const surface = createSavingsMastraMcpSurface(fixtureConfig);
    const tools = server.convertTools(surface.tools, undefined, surface.workflows);

    assert.equal(Boolean(tools.searchUsdcOpportunitiesTool), true);
    assert.equal(Boolean(tools.proposeAllocationTool), true);
    assert.equal(Boolean(tools.run_analyzeSavingsAllocationWorkflow), true);
  });
});
