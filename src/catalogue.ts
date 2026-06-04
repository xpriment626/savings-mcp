import { createKaminoVenueAdapter } from './venues/kamino.js';
import type { VenueAdapter } from './venues/types.js';
import type { AppConfig, FilterOpportunitiesArgs, SavingsCatalogue } from './types.js';

export function createVenueAdapters(config: AppConfig): VenueAdapter[] {
  return [createKaminoVenueAdapter(config)];
}

export async function getUsdcCatalogue(
  config: AppConfig,
  options: { refresh?: boolean } = {}
): Promise<SavingsCatalogue> {
  const [primaryAdapter] = createVenueAdapters(config);
  if (!primaryAdapter) throw new Error('no venue adapters are configured');
  return primaryAdapter.listUsdcOpportunities(options);
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

  return { ...catalogue, opportunities };
}
