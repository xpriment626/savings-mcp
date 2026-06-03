import type { AllocationNudge, RiskPreference, RiskTier, SavingsAsset } from './types.js';

export const CANONICAL_SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const USDC_ASSET: SavingsAsset = Object.freeze({
  symbol: 'USDC',
  mint: CANONICAL_SOLANA_USDC_MINT,
  principal: 'canonical_solana_usdc'
});

export const RISK_ORDINAL: Readonly<Record<RiskTier, number>> = Object.freeze({
  conservative: 0,
  moderate: 1,
  elevated: 2,
  high: 3
});

export const VALID_RISK_PREFERENCES = new Set<RiskPreference>(['conservative', 'balanced', 'aggressive']);

export const VALID_NUDGES = new Set<AllocationNudge>(['more_conservative', 'more_aggressive', 'fewer_pools']);

export function isRiskPreference(value: unknown): value is RiskPreference {
  return typeof value === 'string' && VALID_RISK_PREFERENCES.has(value as RiskPreference);
}

export function isAllocationNudge(value: unknown): value is AllocationNudge {
  return typeof value === 'string' && VALID_NUDGES.has(value as AllocationNudge);
}
