import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getUsdcCatalogue } from '../src/catalogue.js';
import { loadConfig } from '../src/config.js';
import { handleMcpRequest } from '../src/mcp.js';

const runLiveVenueTests = process.env.RUN_LIVE_VENUE_TESTS === '1';

describe('live venue catalogue', () => {
  it(
    'loads live canonical USDC opportunities or structured venue-unavailable reports',
    { skip: runLiveVenueTests ? false : 'set RUN_LIVE_VENUE_TESTS=1 to run live venue checks' },
    async () => {
      const catalogue = await getUsdcCatalogue({ ...loadConfig(), useFixtureCatalogue: false }, { refresh: true });
      const reports = catalogue.venueReports ?? [];

      assert.equal(catalogue.asset.symbol, 'USDC');
      assert.equal(catalogue.source.mode, 'live');
      assert.equal(catalogue.source.venue, 'multi');
      assert.equal(reports.length, 3);

      for (const adapterId of ['kamino', 'jupiter_lend', 'save_solend']) {
        const report = reports.find((entry) => entry.adapterId === adapterId);
        assert.ok(report, `${adapterId} report missing`);
        assert.equal(['ok', 'warning', 'unavailable'].includes(report.status), true);
        assert.equal(Array.isArray(report.warnings), true);
        assert.equal(
          report.opportunityCount > 0 || report.status === 'unavailable',
          true,
          `${adapterId} must return opportunities or be explicitly unavailable`
        );
      }

      assert.equal(catalogue.opportunities.every((opportunity) => opportunity.asset.symbol === 'USDC'), true);
      assert.equal(catalogue.opportunities.every((opportunity) => typeof opportunity.display.displayTitle === 'string'), true);
    }
  );

  it(
    'returns live multi-venue structuredContent through the raw MCP handler',
    { skip: runLiveVenueTests ? false : 'set RUN_LIVE_VENUE_TESTS=1 to run live raw MCP checks' },
    async () => {
      const config = { ...loadConfig(), useFixtureCatalogue: false };
      const response = await handleMcpRequest(config, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_usdc_opportunities',
          arguments: { refresh: true }
        }
      });
      const result = response.result as {
        content?: Array<{ text?: string }>;
        structuredContent?: {
          opportunities?: Array<{ asset?: { symbol?: string }; display?: { displayTitle?: string } }>;
          venueReports?: Array<{ adapterId?: string; status?: string }>;
        };
      };

      assert.equal(response.error, undefined);
      assert.equal(result.content?.[0]?.text?.startsWith('{'), false);
      assert.equal(result.structuredContent?.opportunities?.every((opportunity) => opportunity.asset?.symbol === 'USDC'), true);
      assert.equal(result.structuredContent?.opportunities?.every((opportunity) => typeof opportunity.display?.displayTitle === 'string'), true);
      assert.equal(result.structuredContent?.venueReports?.length, 3);
    }
  );
});
