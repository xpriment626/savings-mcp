import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createVenueAdapters, getFilteredOpportunities } from '../src/catalogue.js';
import { getUsdcCatalogue } from '../src/catalogue.js';
import { loadConfig } from '../src/config.js';
import { createJupiterLendVenueAdapter } from '../src/venues/jupiter-lend.js';
import { createKaminoVenueAdapter } from '../src/venues/kamino.js';
import { createSaveSolendVenueAdapter } from '../src/venues/save-solend.js';

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
    assert.equal(catalogue.opportunities.every((opportunity) => opportunity.capabilities.marketData), true);
    assert.equal(catalogue.opportunities.every((opportunity) => opportunity.capabilities.executionSupported === false), true);
    assert.equal(
      catalogue.opportunities.every((opportunity) => !opportunity.display.status.startsWith('not_')),
      true
    );
  });

  it('lists fixture-backed Jupiter Lend USDC opportunity through the adapter', async () => {
    const adapter = createJupiterLendVenueAdapter(fixtureConfig);

    assert.equal(adapter.id, 'jupiter_lend');
    assert.equal(adapter.name, 'Jupiter Lend');

    const catalogue = await adapter.listUsdcOpportunities({ refresh: true });

    assert.equal(catalogue.source.venue, 'Jupiter Lend');
    assert.equal(catalogue.source.mode, 'fixture');
    assert.deepEqual(catalogue.opportunities.map((opportunity) => opportunity.id), ['jupiter:earn:usdc']);
    assert.equal(catalogue.opportunities[0]?.asset.symbol, 'USDC');
    assert.equal(catalogue.opportunities[0]?.integrationStatus, 'market_data_only');
    assert.equal(catalogue.opportunities[0]?.capabilities.depositTxKnown, false);
    assert.equal(catalogue.opportunities[0]?.display.availableFollowups.includes('propose_allocation'), true);
  });

  it('lists fixture-backed Save/Solend USDC reserve through the adapter', async () => {
    const adapter = createSaveSolendVenueAdapter(fixtureConfig);

    assert.equal(adapter.id, 'save_solend');
    assert.equal(adapter.name, 'Save/Solend');

    const catalogue = await adapter.listUsdcOpportunities({ refresh: true });

    assert.equal(catalogue.source.venue, 'Save/Solend');
    assert.equal(catalogue.source.mode, 'fixture');
    assert.deepEqual(catalogue.opportunities.map((opportunity) => opportunity.id), ['save:lend:main-usdc']);
    assert.equal(catalogue.opportunities[0]?.product_type, 'lending_reserve');
    assert.equal(catalogue.opportunities[0]?.integrationStatus, 'tx_blueprint_known');
    assert.equal(catalogue.opportunities[0]?.capabilities.depositTxKnown, true);
    assert.equal(Number.isFinite(catalogue.opportunities[0]?.liquidity.utilizationPct), true);
  });

  it('keeps the public catalogue API backed by venue adapters', async () => {
    const catalogue = await getUsdcCatalogue(fixtureConfig, { refresh: true });

    assert.equal(catalogue.source.venue, 'multi');
    assert.equal(catalogue.opportunities.some((opportunity) => opportunity.id === 'kamino:lend:main-usdc'), true);
    assert.equal(catalogue.opportunities.some((opportunity) => opportunity.id === 'jupiter:earn:usdc'), true);
    assert.equal(catalogue.opportunities.some((opportunity) => opportunity.id === 'save:lend:main-usdc'), true);
    assert.equal(catalogue.opportunities.every((opportunity) => opportunity.display.availableFollowups.length > 0), true);
  });

  it('creates all three venue adapters and preserves catalogue filters', async () => {
    const adapters = createVenueAdapters(fixtureConfig);
    assert.deepEqual(
      adapters.map((adapter) => adapter.id),
      ['kamino', 'jupiter_lend', 'save_solend']
    );

    const vaultsOnly = await getFilteredOpportunities(fixtureConfig, { productTypes: ['vault'] });

    assert.equal(vaultsOnly.opportunities.every((opportunity) => opportunity.product_type === 'vault'), true);
    assert.equal(vaultsOnly.opportunities.some((opportunity) => opportunity.id === 'jupiter:earn:usdc'), true);
  });
});
