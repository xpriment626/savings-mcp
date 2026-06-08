import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createSavingsMcpServer } from '../src/server.js';
import type { SavingsMcpServer } from '../src/types.js';

let server: SavingsMcpServer | undefined;
let baseUrl: string | undefined;
let exposedToolNames = new Set<string>();

function requireBaseUrl(): string {
  if (typeof baseUrl !== 'string') throw new Error('server base URL is not available');
  return baseUrl;
}

async function rpc(method: string, params: Record<string, unknown> | undefined = undefined, id = 1) {
  const res = await fetch(`${requireBaseUrl()}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });

  assert.equal(res.headers.get('content-type')?.startsWith('application/json'), true);
  return (await res.json()) as { error?: unknown; result?: unknown };
}

function resultText(body: { result?: unknown }): string {
  const result = body.result as { content?: Array<{ text?: unknown }> };
  const text = result.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('MCP result did not include text content');
  return text;
}

function structuredContent<T>(body: { result?: unknown }): T {
  const result = body.result as { structuredContent?: unknown };
  assert.equal(typeof result.structuredContent, 'object');
  return result.structuredContent as T;
}

describe('Savings MCP raw HTTP endpoint', () => {
  before(async () => {
    server = createSavingsMcpServer({
      useFixtureCatalogue: true,
      port: 0
    });
    await server.start();
    baseUrl = server.url ?? undefined;
  });

  after(async () => {
    await server?.stop();
  });

  it('lists savings tools over JSON-RPC', async () => {
    const body = await rpc('tools/list');
    const result = body.result as {
      tools?: Array<{
        name?: string;
        description?: string;
        outputSchema?: unknown;
        annotations?: {
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          openWorldHint?: boolean;
          idempotentHint?: boolean;
        };
      }>;
    };

    assert.deepEqual(body.error, undefined);
    assert.equal(result.tools?.some((tool) => tool.name === 'get_usdc_opportunities'), true);
    assert.equal(result.tools?.some((tool) => tool.name === 'propose_allocation'), true);
    for (const toolName of [
      'get_opportunity',
      'get_metric_packet',
      'calculate_rate_metrics',
      'calculate_liquidity_metrics',
      'calculate_capacity_metrics',
      'calculate_strategy_exposure',
      'screen_opportunities',
      'rank_opportunities',
      'calculate_blended_apy',
      'calculate_blended_risk',
      'calculate_concentration',
      'calculate_rebalance_delta',
      'validate_allocation_inputs',
      'get_history_sample_schema',
      'validate_history_samples',
      'summarize_history_quality',
      'calculate_rate_stability',
      'calculate_yield_percentiles',
      'calculate_historical_liquidity_risk',
      'detect_history_anomalies',
      'compare_historical_opportunities'
    ]) {
      assert.equal(result.tools?.some((tool) => tool.name === toolName), true, `${toolName} missing`);
    }
    exposedToolNames = new Set((result.tools ?? []).map((tool) => String(tool.name)));

    for (const tool of result.tools ?? []) {
      assert.equal(typeof tool.description, 'string');
      assert.equal(tool.description?.includes('Does not authenticate users, sign, send transactions, custody funds, or maintain ledgers.'), true);
      assert.equal(typeof tool.outputSchema, 'object');
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.openWorldHint, false);
      assert.equal(tool.annotations?.idempotentHint, true);
    }
  });

  it('accepts the initialized notification used by MCP clients', async () => {
    const res = await fetch(`${requireBaseUrl()}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    });

    assert.equal(res.status, 202);
    assert.equal(await res.text(), '');
  });

  it('accepts streamable HTTP session termination requests', async () => {
    const res = await fetch(`${requireBaseUrl()}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': 'test-session' }
    });

    assert.equal(res.status, 202);
    assert.equal(await res.text(), '');
  });

  it('returns structured normalized canonical USDC opportunities', async () => {
    const body = await rpc('tools/call', {
      name: 'get_usdc_opportunities',
      arguments: { minTvlUsd: 1_000_000 }
    });

    assert.deepEqual(body.error, undefined);
    assert.equal(resultText(body).length < 120, true);
    assert.equal(resultText(body).trim().startsWith('{'), false);
    const payload = structuredContent<{
      asset?: { mint?: string };
      opportunities?: Array<{
        id?: string;
        venue?: string;
        asset?: { symbol?: string };
        apy?: { current?: unknown };
        capabilities?: {
          marketData?: boolean;
          riskData?: boolean;
          depositTxKnown?: boolean;
          simulationSupported?: boolean;
          executionSupported?: boolean;
        };
        integrationStatus?: string;
        limitations?: string[];
        display?: {
          displayTitle?: string;
          headlineApyPct?: number;
          riskBadge?: string;
          liquidityBadge?: string;
          status?: string;
          primaryWarnings?: string[];
          availableFollowups?: string[];
        };
      }>;
    }>(body);

    assert.equal(payload.asset?.mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    assert.equal(payload.opportunities?.every((opp) => opp.asset?.symbol === 'USDC'), true);
    assert.equal(payload.opportunities?.every((opp) => Number.isFinite(opp.apy?.current)), true);
    assert.equal(payload.opportunities?.every((opp) => opp.capabilities?.marketData === true), true);
    assert.equal(payload.opportunities?.every((opp) => opp.capabilities?.riskData === true), true);
    assert.equal(payload.opportunities?.every((opp) => opp.capabilities?.executionSupported === false), true);
    assert.equal(payload.opportunities?.every((opp) => Array.isArray(opp.limitations)), true);
    assert.equal(
      payload.opportunities?.every((opp) =>
        ['market_data_only', 'tx_blueprint_known', 'simulation_supported'].includes(String(opp.integrationStatus))
      ),
      true
    );
    assert.equal(
      payload.opportunities?.every((opp) => !String(opp.display?.status).startsWith('not_')),
      true
    );
    assert.equal(payload.opportunities?.every((opp) => typeof opp.display?.displayTitle === 'string'), true);
    assert.equal(payload.opportunities?.every((opp) => Number.isFinite(opp.display?.headlineApyPct)), true);
    assert.equal(payload.opportunities?.every((opp) => typeof opp.display?.riskBadge === 'string'), true);
    assert.equal(payload.opportunities?.every((opp) => Array.isArray(opp.display?.availableFollowups)), true);
    assert.equal(
      payload.opportunities?.every((opp) => opp.display?.availableFollowups?.every((toolName) => exposedToolNames.has(toolName))),
      true
    );
    assert.deepEqual(
      new Set(payload.opportunities?.map((opp) => opp.venue)),
      new Set(['Kamino', 'Jupiter Lend', 'Save/Solend'])
    );
    assert.equal(payload.opportunities?.some((opp) => opp.id === 'jupiter:earn:usdc'), true);
    assert.equal(payload.opportunities?.some((opp) => opp.id === 'save:lend:main-usdc'), true);
    assert.equal((payload.opportunities?.length ?? 0) >= 2, true);
  });

  it('returns structured comparison payloads with display summaries', async () => {
    const body = await rpc('tools/call', {
      name: 'compare_opportunities',
      arguments: { opportunityIds: ['kamino:lend:main-usdc', 'jupiter:earn:usdc', 'save:lend:main-usdc'] }
    });

    assert.deepEqual(body.error, undefined);
    assert.equal(resultText(body).trim().startsWith('{'), false);
    const payload = structuredContent<{
      comparison?: Array<{
        id?: string;
        display?: { status?: string; primaryWarnings?: string[] };
      }>;
    }>(body);

    assert.deepEqual(
      payload.comparison?.map((item) => item.id),
      ['kamino:lend:main-usdc', 'jupiter:earn:usdc', 'save:lend:main-usdc']
    );
    assert.equal(payload.comparison?.every((item) => typeof item.display?.status === 'string'), true);
    assert.equal(payload.comparison?.every((item) => Array.isArray(item.display?.primaryWarnings)), true);
  });

  it('proposes structured deterministic allocation weights from selected opportunities', async () => {
    const body = await rpc('tools/call', {
      name: 'propose_allocation',
      arguments: {
        opportunityIds: ['kamino:lend:main-usdc', 'kamino:earn:usdc-core', 'jupiter:earn:usdc'],
        amountUsd: 10_000,
        riskPreference: 'balanced'
      }
    });

    assert.deepEqual(body.error, undefined);
    assert.equal(resultText(body).trim().startsWith('{'), false);
    const payload = structuredContent<{
      display?: {
        displayTitle?: string;
        status?: string;
        riskBadge?: string;
        primaryWarnings?: string[];
        availableFollowups?: string[];
      };
      allocation?: {
        weights?: Array<{ opportunityId: string; weightPct: number }>;
        rationale?: string;
      };
    }>(body);
    const weights = payload.allocation?.weights ?? [];
    const totalWeight = weights.reduce((sum, weight) => sum + weight.weightPct, 0);

    assert.equal(weights.length, 3);
    assert.deepEqual(
      new Set(weights.map((weight) => weight.opportunityId)),
      new Set(['kamino:lend:main-usdc', 'kamino:earn:usdc-core', 'jupiter:earn:usdc'])
    );
    assert.equal(Math.round(totalWeight), 100);
    assert.equal(payload.allocation?.rationale?.includes('deterministic'), true);
    assert.equal(payload.display?.displayTitle, '$10,000 USDC allocation preview');
    assert.equal(payload.display?.status, 'preview_only');
    assert.equal(typeof payload.display?.riskBadge, 'string');
    assert.equal(payload.display?.availableFollowups?.every((toolName) => exposedToolNames.has(toolName)), true);
  });

  it('exposes composable analytics primitives over raw MCP structuredContent', async () => {
    const opportunity = await rpc('tools/call', {
      name: 'get_opportunity',
      arguments: { opportunityId: 'jupiter:earn:usdc' }
    });
    const metricPacket = await rpc('tools/call', {
      name: 'get_metric_packet',
      arguments: { opportunityId: 'jupiter:earn:usdc' }
    });
    const screened = await rpc('tools/call', {
      name: 'screen_opportunities',
      arguments: { integrationStatuses: ['market_data_only'], minTvlUsd: 1_000_000 }
    });
    const blended = await rpc('tools/call', {
      name: 'calculate_blended_apy',
      arguments: {
        weights: [
          { opportunityId: 'kamino:lend:main-usdc', weightPct: 50 },
          { opportunityId: 'jupiter:earn:usdc', weightPct: 50 }
        ]
      }
    });

    assert.deepEqual(opportunity.error, undefined);
    assert.deepEqual(metricPacket.error, undefined);
    assert.deepEqual(screened.error, undefined);
    assert.deepEqual(blended.error, undefined);
    assert.equal(structuredContent<{ opportunity?: { id?: string } }>(opportunity).opportunity?.id, 'jupiter:earn:usdc');
    assert.equal(structuredContent<{ opportunityId?: string }>(metricPacket).opportunityId, 'jupiter:earn:usdc');
    assert.equal(
      structuredContent<{ included?: Array<{ integrationStatus?: string }> }>(screened).included?.every(
        (item) => item.integrationStatus === 'market_data_only'
      ),
      true
    );
    assert.equal(Number.isFinite(structuredContent<{ blendedApyPct?: number }>(blended).blendedApyPct), true);
  });

  it('exposes stateless BYOD historical analytics over raw MCP structuredContent', async () => {
    const samples = [
      { opportunityId: 'kamino:lend:main-usdc', timestamp: '2026-06-01T00:00:00.000Z', apy: 0.04, tvlUsd: 160_000_000, utilizationPct: 70, withdrawalBufferPct: 30, source: 'test' },
      { opportunityId: 'kamino:lend:main-usdc', timestamp: '2026-06-02T00:00:00.000Z', apy: 0.041, tvlUsd: 162_000_000, utilizationPct: 71, withdrawalBufferPct: 29, source: 'test' },
      { opportunityId: 'kamino:lend:main-usdc', timestamp: '2026-06-03T00:00:00.000Z', apy: 0.039, tvlUsd: 161_000_000, utilizationPct: 72, withdrawalBufferPct: 28, source: 'test' }
    ];
    const validation = await rpc('tools/call', {
      name: 'validate_history_samples',
      arguments: { samples }
    });
    const stability = await rpc('tools/call', {
      name: 'calculate_rate_stability',
      arguments: { samples }
    });

    assert.deepEqual(validation.error, undefined);
    assert.deepEqual(stability.error, undefined);
    assert.equal(structuredContent<{ sampleCount?: number }>(validation).sampleCount, 3);
    assert.equal(structuredContent<{ mode?: string; regime?: string }>(stability).mode, 'samples');
    assert.equal(structuredContent<{ mode?: string; regime?: string }>(stability).regime, 'stable');
  });
});
