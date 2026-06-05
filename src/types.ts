import type { z } from 'zod';
import type {
  allocationNudgeSchema,
  allocationWeightSchema,
  opportunityEvidenceSchema,
  productTypeSchema,
  riskPreferenceSchema,
  riskTierSchema,
  savingsAssetSchema,
  savingsCatalogueSchema,
  savingsOpportunitySchema
} from './core/schemas.js';

export type ProductType = z.infer<typeof productTypeSchema>;
export type RiskTier = z.infer<typeof riskTierSchema>;
export type RiskPreference = z.infer<typeof riskPreferenceSchema>;
export type AllocationNudge = z.infer<typeof allocationNudgeSchema>;
export type SavingsAsset = z.infer<typeof savingsAssetSchema>;
export type OpportunityEvidence = z.infer<typeof opportunityEvidenceSchema>;
export type SavingsOpportunity = z.infer<typeof savingsOpportunitySchema>;
export type SavingsCatalogue = z.infer<typeof savingsCatalogueSchema>;
export type AllocationWeight = z.infer<typeof allocationWeightSchema>;

export interface AppConfig {
  host: string;
  port: number;
  kaminoApiBaseUrl: string;
  jupiterLendApiBaseUrl: string;
  saveSolendApiBaseUrl: string;
  requestTimeoutMs: number;
  cacheTtlMs: number;
  useFixtureCatalogue: boolean;
  solanaRpcUrl: string;
  openrouterApiKey: string;
  exaApiKey: string;
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
