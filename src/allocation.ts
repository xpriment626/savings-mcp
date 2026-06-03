import { RISK_ORDINAL, isAllocationNudge, isRiskPreference } from './constants.js';
import { getUsdcCatalogue } from './catalogue.js';
import type {
  AllocationNudge,
  AllocationWeight,
  AppConfig,
  CompareOpportunitiesArgs,
  ProposeAllocationArgs,
  RiskPreference,
  SavingsOpportunity
} from './types.js';

const PREF_AFFINITY: Readonly<Record<RiskPreference, { base: number; slope: number }>> = Object.freeze({
  conservative: { base: 3, slope: 0.8 },
  balanced: { base: 3, slope: 0.4 },
  aggressive: { base: 1.5, slope: -0.5 }
});

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function allocate(
  opportunities: readonly SavingsOpportunity[],
  riskPreference: RiskPreference = 'balanced',
  nudges: readonly AllocationNudge[] = []
): AllocationWeight[] {
  const preference = isRiskPreference(riskPreference) ? riskPreference : 'balanced';
  const { base, slope } = PREF_AFFINITY[preference];

  let entries = opportunities.map((opportunity) => {
    const tier = RISK_ORDINAL[opportunity.risk.tier] ?? 1;
    let affinity = Math.max(0.1, base - slope * tier);

    for (const nudge of nudges.filter(isAllocationNudge)) {
      if (nudge === 'more_conservative') affinity *= Math.max(0.05, 1 - 0.4 * tier);
      if (nudge === 'more_aggressive') affinity *= 1 + 0.4 * tier;
    }

    return { opportunity, affinity: Math.max(0.001, affinity) };
  });

  const drops = nudges.filter((n) => n === 'fewer_pools').length;
  if (drops > 0 && entries.length - drops >= 2) {
    entries = [...entries].sort((a, b) => b.affinity - a.affinity).slice(0, entries.length - drops);
  }

  const total = entries.reduce((sum, entry) => sum + entry.affinity, 0) || 1;
  return entries
    .map((entry) => ({ entry, weightPct: round1((entry.affinity / total) * 100) }))
    .sort((a, b) => b.weightPct - a.weightPct || a.entry.opportunity.id.localeCompare(b.entry.opportunity.id))
    .map(({ entry, weightPct }) => ({
      opportunityId: entry.opportunity.id,
      title: entry.opportunity.title,
      venue: entry.opportunity.venue,
      productType: entry.opportunity.product_type,
      riskTier: entry.opportunity.risk.tier,
      weightPct,
      apy: entry.opportunity.apy.current
    }));
}

function blendedApyPct(weights: readonly AllocationWeight[]): number {
  return Math.round(weights.reduce((sum, weight) => sum + (weight.weightPct / 100) * weight.apy, 0) * 10_000) / 100;
}

function blendedRiskScore(weights: readonly AllocationWeight[], opportunities: readonly SavingsOpportunity[]): number {
  const scoreById = new Map(opportunities.map((opp) => [opp.id, opp.risk.score]));
  return Math.round(
    weights.reduce((sum, weight) => sum + (weight.weightPct / 100) * (scoreById.get(weight.opportunityId) ?? 50), 0)
  );
}

function riskEnvelope(score: number): string {
  if (score <= 25) return 'Conservative USDC savings exposure';
  if (score <= 45) return 'Balanced USDC savings exposure';
  if (score <= 65) return 'Elevated USDC savings exposure';
  return 'High-risk USDC savings exposure';
}

export async function compareOpportunities(config: AppConfig, args: CompareOpportunitiesArgs = {}) {
  const catalogue = await getUsdcCatalogue(config, { refresh: Boolean(args.refresh) });
  const ids = Array.isArray(args.opportunityIds) ? new Set(args.opportunityIds) : null;
  const opportunities = ids ? catalogue.opportunities.filter((opp) => ids.has(opp.id)) : catalogue.opportunities;

  return {
    asset: catalogue.asset,
    generated_at: catalogue.generated_at,
    comparison: opportunities
      .map((opp) => ({
        id: opp.id,
        title: opp.title,
        venue: opp.venue,
        product_type: opp.product_type,
        apy: opp.apy,
        tvl: opp.tvl,
        liquidity: opp.liquidity,
        risk: opp.risk,
        flags: opp.flags,
        evidence: opp.evidence
      }))
      .sort((a, b) => a.risk.score - b.risk.score || b.apy.current - a.apy.current)
  };
}

export async function proposeAllocation(config: AppConfig, args: ProposeAllocationArgs = {}) {
  const opportunityIds = Array.isArray(args.opportunityIds) ? args.opportunityIds : [];
  if (opportunityIds.length < 2) throw new Error('opportunityIds must contain at least 2 ids');

  const amountUsd = Number(args.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('amountUsd must be positive');

  const riskPreference = isRiskPreference(args.riskPreference) ? args.riskPreference : 'balanced';
  const nudges = Array.isArray(args.nudges) ? args.nudges.filter(isAllocationNudge) : [];

  const catalogue = await getUsdcCatalogue(config, { refresh: Boolean(args.refresh) });
  const byId = new Map(catalogue.opportunities.map((opp) => [opp.id, opp]));
  const selected = opportunityIds.map((id) => byId.get(id)).filter((opp): opp is SavingsOpportunity => Boolean(opp));
  if (selected.length < 2) throw new Error('at least 2 selected opportunities must exist in the current catalogue');

  const weights = allocate(selected, riskPreference, nudges);
  const riskScore = blendedRiskScore(weights, selected);

  return {
    mandate: {
      opportunityIds: selected.map((opp) => opp.id),
      amountUsd,
      riskPreference,
      nudges
    },
    allocation: {
      weights,
      blendedApyPct: blendedApyPct(weights),
      blendedRiskScore: riskScore,
      riskEnvelope: riskEnvelope(riskScore),
      rebalanceStrategy:
        'Review on catalogue refresh; rebalance when a sleeve drifts more than 5% from target or a venue risk tier degrades.',
      rationale:
        'Allocation is deterministic library math over selected USDC opportunities; agent narration or future Coral coordination should explain the result, not choose weights randomly.'
    },
    generated_at: catalogue.generated_at
  };
}
