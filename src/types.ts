export type ProductType = 'lending_reserve' | 'vault';
export type RiskTier = 'conservative' | 'moderate' | 'elevated' | 'high';
export type RiskPreference = 'conservative' | 'balanced' | 'aggressive';
export type AllocationNudge = 'more_conservative' | 'more_aggressive' | 'fewer_pools';

export interface AppConfig {
  host: string;
  port: number;
  kaminoApiBaseUrl: string;
  requestTimeoutMs: number;
  cacheTtlMs: number;
  useFixtureCatalogue: boolean;
  solanaRpcUrl: string;
  openrouterApiKey: string;
  exaApiKey: string;
}

export interface SavingsAsset {
  symbol: 'USDC';
  mint: string;
  principal: 'canonical_solana_usdc';
}

export interface OpportunityEvidence {
  label: string;
  url: string;
  observedAt: string;
}

export interface SavingsOpportunity {
  id: string;
  venue: string;
  protocol: string;
  product_type: ProductType;
  title: string;
  asset: SavingsAsset;
  apy: {
    current: number;
    source: string;
    window: string;
  };
  tvl: {
    usd: number;
  };
  liquidity: {
    utilizationPct: number | null;
    withdrawalBufferPct: number | null;
  };
  risk: {
    tier: RiskTier;
    score: number;
    factors: string[];
    synthesis: string;
  };
  flags: {
    depositable: boolean;
    simulatable: boolean;
  };
  refs: {
    market?: string;
    reserve?: string;
    vault?: string;
    assetMint?: string;
  };
  evidence: OpportunityEvidence[];
  generated_at: string;
}

export interface SavingsCatalogue {
  asset: SavingsAsset;
  generated_at: string;
  source: {
    venue: string;
    mode: 'fixture' | 'live';
    baseUrl?: string;
  };
  opportunities: SavingsOpportunity[];
}

export interface FilterOpportunitiesArgs {
  refresh?: boolean;
  limit?: number;
  minTvlUsd?: number;
  productTypes?: ProductType[];
}

export interface CompareOpportunitiesArgs {
  opportunityIds?: string[];
  refresh?: boolean;
}

export interface ProposeAllocationArgs {
  opportunityIds?: string[];
  amountUsd?: number;
  riskPreference?: RiskPreference;
  nudges?: AllocationNudge[];
  refresh?: boolean;
}

export interface AllocationWeight {
  opportunityId: string;
  title: string;
  venue: string;
  productType: ProductType;
  riskTier: RiskTier;
  weightPct: number;
  apy: number;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface SavingsMcpServer {
  readonly url: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}
