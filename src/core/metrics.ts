import type { SavingsCatalogue, SavingsOpportunity } from '../types.js';
import type { DataQualityReport, EligibilityReport, MetricPacket } from './schemas.js';

function withdrawalModeFor(opportunity: SavingsOpportunity): MetricPacket['liquidity']['withdrawalMode'] {
  if (opportunity.product_type === 'vault') return 'unknown';
  if (opportunity.liquidity.withdrawalBufferPct !== null) return 'buffer';
  return 'unknown';
}

function usesExternalStrategies(opportunity: SavingsOpportunity): boolean {
  return opportunity.product_type === 'vault';
}

export function buildMetricPacket(opportunity: SavingsOpportunity): MetricPacket {
  return {
    opportunityId: opportunity.id,
    venue: opportunity.venue,
    protocol: opportunity.protocol,
    productType: opportunity.product_type,
    fetchedAt: opportunity.generated_at,
    rate: {
      currentApy: opportunity.apy.current,
      source: opportunity.apy.source,
      window: opportunity.apy.window
    },
    scale: {
      tvlUsd: opportunity.tvl.usd
    },
    liquidity: {
      utilizationPct: opportunity.liquidity.utilizationPct,
      withdrawalBufferPct: opportunity.liquidity.withdrawalBufferPct,
      withdrawalMode: withdrawalModeFor(opportunity)
    },
    riskInputs: {
      tier: opportunity.risk.tier,
      score: opportunity.risk.score,
      factors: opportunity.risk.factors,
      synthesis: opportunity.risk.synthesis,
      venueSpecific: {
        refs: opportunity.refs,
        productType: opportunity.product_type
      }
    },
    receipt: {
      mint: opportunity.refs.vault,
      symbol: opportunity.product_type === 'vault' ? opportunity.title : undefined
    },
    capabilities: {
      ...opportunity.capabilities,
      requiresKyc: false,
      accessGated: false,
      hasLpExposure: false,
      usesExternalStrategies: usesExternalStrategies(opportunity)
    },
    evidence: opportunity.evidence
  };
}

function opportunityWarnings(opportunity: SavingsOpportunity): string[] {
  const warnings: string[] = [];
  if (opportunity.evidence.length === 0) warnings.push('missing evidence');
  if (!Number.isFinite(opportunity.apy.current)) warnings.push('APY is not finite');
  if (opportunity.tvl.usd <= 0) warnings.push('TVL is missing or zero');
  warnings.push(...opportunity.limitations);
  if (opportunity.product_type === 'vault') warnings.push('managed vault strategy details are not fully normalized yet');
  return warnings;
}

export function buildDataQualityReport(
  catalogue: SavingsCatalogue,
  opportunityIds: readonly string[] | undefined = undefined
): DataQualityReport {
  const ids = opportunityIds ? new Set(opportunityIds) : null;
  const opportunities = ids ? catalogue.opportunities.filter((opportunity) => ids.has(opportunity.id)) : catalogue.opportunities;
  const warnings: string[] = [];
  if (catalogue.source.mode === 'fixture') warnings.push('catalogue is fixture-backed; do not treat metrics as live market data');
  if (opportunities.length === 0) warnings.push('no opportunities matched the data quality request');

  const opportunityReports = opportunities.map((opportunity) => {
    const itemWarnings = opportunityWarnings(opportunity);
    return {
      opportunityId: opportunity.id,
      status: itemWarnings.length > 0 ? ('warning' as const) : ('ok' as const),
      warnings: itemWarnings,
      evidenceCount: opportunity.evidence.length
    };
  });

  return {
    checkedAt: new Date().toISOString(),
    mode: catalogue.source.mode,
    warnings,
    opportunityReports
  };
}

function eligibilityReasons(opportunity: SavingsOpportunity): string[] {
  const reasons: string[] = [];
  if (opportunity.evidence.length === 0) reasons.push('opportunity has no evidence links');
  if (!Number.isFinite(opportunity.apy.current)) reasons.push('opportunity APY is not finite');
  return reasons;
}

export function buildEligibilityReport(
  opportunities: readonly SavingsOpportunity[],
  requestedIds: readonly string[]
): EligibilityReport {
  const availableIds = new Set(opportunities.map((opportunity) => opportunity.id));
  const ineligible = opportunities
    .map((opportunity) => ({ opportunityId: opportunity.id, reasons: eligibilityReasons(opportunity) }))
    .filter((entry) => entry.reasons.length > 0);
  const missing = requestedIds.filter((id) => !availableIds.has(id));

  for (const opportunityId of missing) {
    ineligible.push({ opportunityId, reasons: ['requested opportunity was not found in the catalogue'] });
  }

  const warnings = ineligible.flatMap((entry) => entry.reasons.map((reason) => `${entry.opportunityId}: ${reason}`));
  const eligibleOpportunityIds = opportunities
    .filter((opportunity) => eligibilityReasons(opportunity).length === 0)
    .map((opportunity) => opportunity.id);

  return {
    status: missing.length > 0 ? 'blocked' : ineligible.length > 0 ? 'warning' : 'ok',
    eligibleOpportunityIds,
    ineligible,
    warnings
  };
}

export function orderedSelectedOpportunities(
  opportunities: readonly SavingsOpportunity[],
  requestedIds: readonly string[]
): SavingsOpportunity[] {
  const byId = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]));
  return requestedIds.map((id) => byId.get(id)).filter((opportunity): opportunity is SavingsOpportunity => Boolean(opportunity));
}
