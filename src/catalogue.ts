import { createKaminoVenueAdapter } from './venues/kamino.js';
import { createJupiterLendVenueAdapter } from './venues/jupiter-lend.js';
import { createSaveSolendVenueAdapter } from './venues/save-solend.js';
import type { VenueAdapter } from './venues/types.js';
import type { AppConfig, FilterOpportunitiesArgs, SavingsCatalogue } from './types.js';
import { USDC_ASSET } from './constants.js';

export function createVenueAdapters(config: AppConfig): VenueAdapter[] {
  return [createKaminoVenueAdapter(config), createJupiterLendVenueAdapter(config), createSaveSolendVenueAdapter(config)];
}

function sortedOpportunities(catalogue: SavingsCatalogue): SavingsCatalogue['opportunities'] {
  return [...catalogue.opportunities].sort(
    (a, b) =>
      a.risk.score - b.risk.score ||
      b.tvl.usd - a.tvl.usd ||
      b.apy.current - a.apy.current ||
      a.id.localeCompare(b.id)
  );
}

export async function getUsdcCatalogue(
  config: AppConfig,
  options: { refresh?: boolean } = {}
): Promise<SavingsCatalogue> {
  const adapters = createVenueAdapters(config);
  if (adapters.length === 0) throw new Error('no venue adapters are configured');

  const mode = config.useFixtureCatalogue ? 'fixture' : 'live';
  const generatedAt = new Date().toISOString();
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const catalogue = await adapter.listUsdcOpportunities(options);
        const warnings = catalogue.warnings ?? [];
        return {
          catalogue,
          report: {
            adapterId: adapter.id,
            venue: adapter.name,
            status: catalogue.opportunities.length === 0 || warnings.length > 0 ? ('warning' as const) : ('ok' as const),
            opportunityCount: catalogue.opportunities.length,
            warnings
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          catalogue: null,
          report: {
            adapterId: adapter.id,
            venue: adapter.name,
            status: 'unavailable' as const,
            opportunityCount: 0,
            warnings: [`${adapter.name} unavailable: ${message}`]
          }
        };
      }
    })
  );

  const opportunities = sortedOpportunities({
    asset: USDC_ASSET,
    generated_at: generatedAt,
    source: { venue: 'multi', mode },
    opportunities: results.flatMap((result) => result.catalogue?.opportunities ?? [])
  });
  const warnings = results.flatMap((result) => result.report.warnings);

  const catalogue: SavingsCatalogue = {
    asset: USDC_ASSET,
    generated_at: generatedAt,
    source: { venue: 'multi', mode },
    opportunities,
    venueReports: results.map((result) => result.report)
  };
  if (warnings.length > 0) catalogue.warnings = warnings;
  return catalogue;
}

export async function getFilteredOpportunities(
  config: AppConfig,
  args: FilterOpportunitiesArgs = {}
): Promise<SavingsCatalogue> {
  const catalogue = await getUsdcCatalogue(config, { refresh: Boolean(args.refresh) });
  const productTypes = Array.isArray(args.productTypes) ? new Set(args.productTypes) : null;
  const minTvlUsd = Number.isFinite(Number(args.minTvlUsd)) ? Number(args.minTvlUsd) : 0;
  const limit = Number.isFinite(Number(args.limit)) ? Math.max(0, Number(args.limit)) : null;

  let opportunities = catalogue.opportunities.filter((opp) => opp.tvl.usd >= minTvlUsd);
  if (productTypes) opportunities = opportunities.filter((opp) => productTypes.has(opp.product_type));
  if (limit !== null) opportunities = opportunities.slice(0, limit);

  return { ...catalogue, opportunities: sortedOpportunities({ ...catalogue, opportunities }) };
}
