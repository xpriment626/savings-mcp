import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getUsdcCatalogue } from '../src/catalogue.js';
import { loadConfig } from '../src/config.js';
import { createKaminoVenueAdapter } from '../src/venues/kamino.js';

const fixtureConfig = { ...loadConfig(), useFixtureCatalogue: true, port: 0 };

describe('venue adapter contract', () => {
  it('lists fixture-backed Kamino USDC opportunities through the adapter', async () => {
    const adapter = createKaminoVenueAdapter(fixtureConfig);

    assert.equal(adapter.id, 'kamino');
    assert.equal(adapter.name, 'Kamino');

    const catalogue = await adapter.listUsdcOpportunities({ refresh: true });

    assert.equal(catalogue.source.venue, 'Kamino');
    assert.equal(catalogue.source.mode, 'fixture');
    assert.equal(catalogue.opportunities.every((opportunity) => opportunity.id.startsWith('kamino:')), true);
    assert.equal(catalogue.opportunities.every((opportunity) => typeof opportunity.display.displayTitle === 'string'), true);
  });

  it('keeps the public catalogue API backed by venue adapters', async () => {
    const catalogue = await getUsdcCatalogue(fixtureConfig, { refresh: true });

    assert.equal(catalogue.source.venue, 'Kamino');
    assert.equal(catalogue.opportunities.some((opportunity) => opportunity.id === 'kamino:lend:main-usdc'), true);
    assert.equal(catalogue.opportunities.every((opportunity) => opportunity.display.availableFollowups.length > 0), true);
  });
});
