import type { SavingsCatalogue } from '../types.js';

export interface ListUsdcOpportunitiesOptions {
  refresh?: boolean;
}

export interface VenueAdapter {
  readonly id: string;
  readonly name: string;
  listUsdcOpportunities(options?: ListUsdcOpportunitiesOptions): Promise<SavingsCatalogue>;
}
