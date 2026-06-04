import type { SavingsOpportunity } from '../types.js';
import type { AllocationOutput, CompareOpportunitiesOutput } from './schemas.js';

type OpportunityWithoutDisplay = Omit<SavingsOpportunity, 'display'>;

function roundPct(value: number): number {
  return Math.round(value * 10_000) / 100;
}

function opportunityStatus(opportunity: OpportunityWithoutDisplay): SavingsOpportunity['display']['status'] {
  if (opportunity.flags.depositable && opportunity.flags.simulatable) return 'depositable';
  if (!opportunity.flags.depositable) return 'not_depositable';
  if (!opportunity.flags.simulatable) return 'not_simulatable';
  return 'needs_review';
}

function liquidityBadge(opportunity: OpportunityWithoutDisplay): string {
  const buffer = opportunity.liquidity.withdrawalBufferPct;
  const utilization = opportunity.liquidity.utilizationPct;
  if (buffer !== null) return `${Math.round(buffer)}% withdrawal buffer`;
  if (utilization !== null) return `${Math.round(utilization)}% utilization`;
  if (opportunity.product_type === 'vault') return 'managed vault exit path';
  return 'liquidity details pending';
}

function opportunityWarnings(opportunity: OpportunityWithoutDisplay): string[] {
  const warnings: string[] = [];
  if (!opportunity.flags.depositable) warnings.push('not currently marked depositable');
  if (!opportunity.flags.simulatable) warnings.push('not currently simulatable');
  if (opportunity.product_type === 'vault') warnings.push('managed strategy exposure requires review');
  if (opportunity.liquidity.utilizationPct !== null && opportunity.liquidity.utilizationPct >= 85) {
    warnings.push('high utilization can slow exits');
  }
  if (opportunity.evidence.length === 0) warnings.push('missing evidence links');
  return warnings.slice(0, 4);
}

export function buildOpportunityDisplay(opportunity: OpportunityWithoutDisplay): SavingsOpportunity['display'] {
  return {
    displayTitle: `${opportunity.title} (${opportunity.venue})`,
    headlineApyPct: roundPct(opportunity.apy.current),
    riskBadge: `${opportunity.risk.tier} risk`,
    liquidityBadge: liquidityBadge(opportunity),
    status: opportunityStatus(opportunity),
    primaryWarnings: opportunityWarnings(opportunity),
    availableFollowups: [
      'get_usdc_opportunities',
      'compare_opportunities',
      'propose_allocation'
    ]
  };
}

export function attachOpportunityDisplay<TOpportunity extends OpportunityWithoutDisplay>(
  opportunity: TOpportunity
): TOpportunity & { display: SavingsOpportunity['display'] } {
  return {
    ...opportunity,
    display: buildOpportunityDisplay(opportunity)
  };
}

function allocationWarnings(): string[] {
  return [
    'preview only; no auth, signing, transaction sending, custody, or ledger persistence'
  ];
}

export function buildAllocationDisplay(input: {
  amountUsd: number;
  blendedApyPct: number;
  riskEnvelope: string;
}): AllocationOutput['display'] {
  return {
    displayTitle: `$${input.amountUsd.toLocaleString('en-US')} USDC allocation preview`,
    headlineApyPct: input.blendedApyPct,
    riskBadge: input.riskEnvelope,
    status: 'preview_only',
    primaryWarnings: allocationWarnings(),
    availableFollowups: [
      'get_usdc_opportunities',
      'compare_opportunities',
      'propose_allocation'
    ]
  };
}

export function compareEntryFromOpportunity(opportunity: SavingsOpportunity): CompareOpportunitiesOutput['comparison'][number] {
  return {
    id: opportunity.id,
    title: opportunity.title,
    venue: opportunity.venue,
    product_type: opportunity.product_type,
    apy: opportunity.apy,
    tvl: opportunity.tvl,
    liquidity: opportunity.liquidity,
    risk: opportunity.risk,
    flags: opportunity.flags,
    evidence: opportunity.evidence,
    display: opportunity.display
  };
}
