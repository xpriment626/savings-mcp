import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createSavingsMcpServer } from '../src/server.js';
import type { SavingsMcpServer } from '../src/types.js';

let server: SavingsMcpServer | undefined;
let baseUrl: string | undefined;

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
    const result = body.result as { tools?: Array<{ name?: string }> };

    assert.deepEqual(body.error, undefined);
    assert.equal(result.tools?.some((tool) => tool.name === 'get_usdc_opportunities'), true);
    assert.equal(result.tools?.some((tool) => tool.name === 'propose_allocation'), true);
  });

  it('returns normalized canonical USDC opportunities', async () => {
    const body = await rpc('tools/call', {
      name: 'get_usdc_opportunities',
      arguments: { minTvlUsd: 1_000_000 }
    });

    assert.deepEqual(body.error, undefined);
    const payload = JSON.parse(resultText(body)) as {
      asset?: { mint?: string };
      opportunities?: Array<{ asset?: { symbol?: string }; apy?: { current?: unknown } }>;
    };

    assert.equal(payload.asset?.mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    assert.equal(payload.opportunities?.every((opp) => opp.asset?.symbol === 'USDC'), true);
    assert.equal(payload.opportunities?.every((opp) => Number.isFinite(opp.apy?.current)), true);
    assert.equal((payload.opportunities?.length ?? 0) >= 2, true);
  });

  it('proposes deterministic allocation weights from selected opportunities', async () => {
    const body = await rpc('tools/call', {
      name: 'propose_allocation',
      arguments: {
        opportunityIds: ['kamino:lend:main-usdc', 'kamino:earn:usdc-core'],
        amountUsd: 10_000,
        riskPreference: 'balanced'
      }
    });

    assert.deepEqual(body.error, undefined);
    const payload = JSON.parse(resultText(body)) as {
      allocation?: {
        weights?: Array<{ weightPct: number }>;
        rationale?: string;
      };
    };
    const weights = payload.allocation?.weights ?? [];
    const totalWeight = weights.reduce((sum, weight) => sum + weight.weightPct, 0);

    assert.equal(weights.length, 2);
    assert.equal(Math.round(totalWeight), 100);
    assert.equal(payload.allocation?.rationale?.includes('deterministic'), true);
  });
});
