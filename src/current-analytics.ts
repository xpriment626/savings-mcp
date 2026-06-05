import { getUsdcCatalogue } from './catalogue.js';
import {
  analyzeCapacityUtilization,
  analyzeExitLiquidity,
  analyzeRateQuality,
  analyzeStrategyExposure
} from './core/analysis.js';
import { buildMetricPacket } from './core/metrics.js';
import {
  allocationValidationOutputSchema,
  blendedApyOutputSchema,
  blendedRiskOutputSchema,
  concentrationOutputSchema,
  currentOpportunityAnalyticsOutputSchema,
  getOpportunityOutputSchema,
  rankOpportunitiesOutputSchema,
  rebalanceDeltaOutputSchema,
  screenOpportunitiesOutputSchema
} from './core/schemas.js';
import type {
  AllocationInputWeight,
  MetricPacket
} from './core/schemas.js';
import type { AppConfig, SavingsCatalogue, SavingsOpportunity } from './types.js';

type RankBy = 'risk_adjusted_apy' | 'apy' | 'tvl' | 'risk' | 'liquidity';

interface OpportunityLookupArgs {
  opportunityId: string;
  refresh?: boolean | undefined;
}

interface ScreenOpportunitiesArgs {
  refresh?: boolean | undefined;
  opportunityIds?: string[] | undefined;
  venues?: string[] | undefined;
  productTypes?: Array<SavingsOpportunity['product_type']> | undefined;
  integrationStatuses?: Array<SavingsOpportunity['integrationStatus']> | undefined;
  minTvlUsd?: number | undefined;
  minApyPct?: number | undefined;
  maxRiskScore?: number | undefined;
  minWithdrawalBufferPct?: number | undefined;
}

interface RankOpportunitiesArgs {
  refresh?: boolean | undefined;
  opportunityIds?: string[] | undefined;
  rankBy?: RankBy | undefined;
}

interface AllocationWeightsArgs {
  refresh?: boolean | undefined;
  amountUsd?: number | undefined;
  weights: AllocationInputWeight[];
}

interface RebalanceDeltaArgs {
  refresh?: boolean | undefined;
  amountUsd?: number | undefined;
  currentWeights: AllocationInputWeight[];
  targetWeights: AllocationInputWeight[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function riskEnvelope(score: number): string {
  if (score <= 25) return 'Conservative USDC savings exposure';
  if (score <= 45) return 'Balanced USDC savings exposure';
  if (score <= 65) return 'Elevated USDC savings exposure';
  return 'High-risk USDC savings exposure';
}

function rowFromOpportunity(opportunity: SavingsOpportunity) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    venue: opportunity.venue,
    productType: opportunity.product_type,
    apyPct: round2(opportunity.apy.current * 100),
    tvlUsd: opportunity.tvl.usd,
    riskTier: opportunity.risk.tier,
    riskScore: opportunity.risk.score,
    integrationStatus: opportunity.integrationStatus,
    capabilities: opportunity.capabilities,
    limitations: opportunity.limitations,
    display: opportunity.display
  };
}

function opportunityMap(catalogue: SavingsCatalogue): Map<string, SavingsOpportunity> {
  return new Map(catalogue.opportunities.map((opportunity) => [opportunity.id, opportunity]));
}

function totalWeight(weights: readonly AllocationInputWeight[]): number {
  return round4(weights.reduce((sum, weight) => sum + weight.weightPct, 0));
}

function duplicateIds(weights: readonly AllocationInputWeight[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const weight of weights) {
    if (seen.has(weight.opportunityId)) duplicates.add(weight.opportunityId);
    seen.add(weight.opportunityId);
  }
  return [...duplicates].sort();
}

async function loadSelected(
  config: AppConfig,
  args: { refresh?: boolean | undefined; opportunityIds?: readonly string[] | undefined }
): Promise<{ catalogue: SavingsCatalogue; selected: SavingsOpportunity[]; byId: Map<string, SavingsOpportunity> }> {
  const catalogue = await getUsdcCatalogue(config, { refresh: Boolean(args.refresh) });
  const byId = opportunityMap(catalogue);
  const ids = args.opportunityIds ? new Set(args.opportunityIds) : null;
  const selected = ids ? catalogue.opportunities.filter((opportunity) => ids.has(opportunity.id)) : catalogue.opportunities;
  return { catalogue, selected, byId };
}

async function findOpportunity(config: AppConfig, args: OpportunityLookupArgs) {
  const catalogue = await getUsdcCatalogue(config, { refresh: Boolean(args.refresh) });
  const opportunity = catalogue.opportunities.find((item) => item.id === args.opportunityId);
  if (!opportunity) throw new Error(`unknown opportunity ${args.opportunityId}`);
  return { catalogue, opportunity };
}

function allocationComponents(
  weights: readonly AllocationInputWeight[],
  byId: Map<string, SavingsOpportunity>
) {
  return weights.map((weight) => {
    const opportunity = byId.get(weight.opportunityId);
    if (!opportunity) throw new Error(`unknown opportunity ${weight.opportunityId}`);
    return { weight, opportunity };
  });
}

function screenReasons(opportunity: SavingsOpportunity, args: ScreenOpportunitiesArgs): string[] {
  const reasons: string[] = [];
  if (args.opportunityIds && !args.opportunityIds.includes(opportunity.id)) reasons.push('opportunity id not requested');
  if (args.venues && !args.venues.includes(opportunity.venue)) reasons.push('venue filter');
  if (args.productTypes && !args.productTypes.includes(opportunity.product_type)) reasons.push('product type filter');
  if (args.integrationStatuses && !args.integrationStatuses.includes(opportunity.integrationStatus)) {
    reasons.push('integration status filter');
  }
  if (Number.isFinite(args.minTvlUsd) && opportunity.tvl.usd < Number(args.minTvlUsd)) reasons.push('below minimum TVL');
  if (Number.isFinite(args.minApyPct) && opportunity.apy.current * 100 < Number(args.minApyPct)) reasons.push('below minimum APY');
  if (Number.isFinite(args.maxRiskScore) && opportunity.risk.score > Number(args.maxRiskScore)) {
    reasons.push('above maximum risk score');
  }
  if (
    Number.isFinite(args.minWithdrawalBufferPct) &&
    (opportunity.liquidity.withdrawalBufferPct === null ||
      opportunity.liquidity.withdrawalBufferPct < Number(args.minWithdrawalBufferPct))
  ) {
    reasons.push('below minimum withdrawal buffer');
  }
  return reasons;
}

function liquidityRankScore(packet: MetricPacket): number {
  const buffer = packet.liquidity.withdrawalBufferPct ?? 0;
  const utilization = packet.liquidity.utilizationPct ?? 100 - buffer;
  return round2(buffer - Math.max(0, utilization - 75));
}

function rankScore(opportunity: SavingsOpportunity, rankBy: RankBy): number {
  if (rankBy === 'apy') return round2(opportunity.apy.current * 100);
  if (rankBy === 'tvl') return round2(opportunity.tvl.usd);
  if (rankBy === 'risk') return round2(100 - opportunity.risk.score);
  if (rankBy === 'liquidity') return liquidityRankScore(buildMetricPacket(opportunity));
  return round2(opportunity.apy.current * 100 * ((100 - opportunity.risk.score) / 100));
}

function groupWeights<T extends string>(
  entries: Array<{ key: T; weightPct: number }>,
  label: string
): Array<Record<typeof label, T> & { weightPct: number }> {
  const totals = new Map<T, number>();
  for (const entry of entries) totals.set(entry.key, (totals.get(entry.key) ?? 0) + entry.weightPct);
  return [...totals.entries()]
    .map(([key, weightPct]) => ({ [label]: key, weightPct: round4(weightPct) }) as Record<typeof label, T> & { weightPct: number })
    .sort((a, b) => b.weightPct - a.weightPct || String(a[label]).localeCompare(String(b[label])));
}

export async function getOpportunity(config: AppConfig, args: OpportunityLookupArgs) {
  const { catalogue, opportunity } = await findOpportunity(config, args);
  return getOpportunityOutputSchema.parse({
    asset: catalogue.asset,
    generated_at: catalogue.generated_at,
    source: catalogue.source,
    opportunity
  });
}

export async function getMetricPacket(config: AppConfig, args: OpportunityLookupArgs) {
  const { opportunity } = await findOpportunity(config, args);
  return buildMetricPacket(opportunity);
}

export async function calculateOpportunityAnalytics(config: AppConfig, args: OpportunityLookupArgs) {
  const { opportunity } = await findOpportunity(config, args);
  const metricPacket = buildMetricPacket(opportunity);
  return currentOpportunityAnalyticsOutputSchema.parse({
    opportunity,
    metricPacket,
    rateMetrics: analyzeRateQuality(metricPacket),
    liquidityMetrics: analyzeExitLiquidity(metricPacket),
    capacityMetrics: analyzeCapacityUtilization(metricPacket),
    strategyExposure: analyzeStrategyExposure(metricPacket)
  });
}

export async function calculateRateMetrics(config: AppConfig, args: OpportunityLookupArgs) {
  return analyzeRateQuality(await getMetricPacket(config, args));
}

export async function calculateLiquidityMetrics(config: AppConfig, args: OpportunityLookupArgs) {
  return analyzeExitLiquidity(await getMetricPacket(config, args));
}

export async function calculateCapacityMetrics(config: AppConfig, args: OpportunityLookupArgs) {
  return analyzeCapacityUtilization(await getMetricPacket(config, args));
}

export async function calculateStrategyExposure(config: AppConfig, args: OpportunityLookupArgs) {
  return analyzeStrategyExposure(await getMetricPacket(config, args));
}

export async function screenOpportunities(config: AppConfig, args: ScreenOpportunitiesArgs = {}) {
  const { catalogue } = await loadSelected(config, { refresh: args.refresh });
  const included = [];
  const excluded = [];

  for (const opportunity of catalogue.opportunities) {
    const reasons = screenReasons(opportunity, args);
    const row = rowFromOpportunity(opportunity);
    if (reasons.length === 0) included.push(row);
    else excluded.push({ ...row, reasons });
  }

  return screenOpportunitiesOutputSchema.parse({
    asset: catalogue.asset,
    generated_at: catalogue.generated_at,
    criteria: {
      opportunityIds: args.opportunityIds,
      venues: args.venues,
      productTypes: args.productTypes,
      integrationStatuses: args.integrationStatuses,
      minTvlUsd: args.minTvlUsd,
      minApyPct: args.minApyPct,
      maxRiskScore: args.maxRiskScore,
      minWithdrawalBufferPct: args.minWithdrawalBufferPct
    },
    included,
    excluded
  });
}

export async function rankOpportunities(config: AppConfig, args: RankOpportunitiesArgs = {}) {
  const rankBy = args.rankBy ?? 'risk_adjusted_apy';
  const { catalogue, selected } = await loadSelected(config, { refresh: args.refresh, opportunityIds: args.opportunityIds });
  const ranked = selected
    .map((opportunity) => ({
      ...rowFromOpportunity(opportunity),
      rank: 0,
      rankScore: rankScore(opportunity, rankBy)
    }))
    .sort((a, b) => b.rankScore - a.rankScore || a.riskScore - b.riskScore || a.id.localeCompare(b.id))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  return rankOpportunitiesOutputSchema.parse({
    asset: catalogue.asset,
    generated_at: catalogue.generated_at,
    rankBy,
    ranked
  });
}

export async function validateAllocationInputs(config: AppConfig, args: AllocationWeightsArgs) {
  const { catalogue, byId } = await loadSelected(config, {
    refresh: args.refresh,
    opportunityIds: args.weights.map((weight) => weight.opportunityId)
  });
  const missingOpportunityIds = args.weights
    .map((weight) => weight.opportunityId)
    .filter((id) => !byId.has(id));
  const duplicateOpportunityIds = duplicateIds(args.weights);
  const errors: string[] = [];
  const warnings: string[] = [];
  const sum = totalWeight(args.weights);
  const amountUsd = args.amountUsd === undefined ? null : Number(args.amountUsd);

  if (args.weights.length === 0) errors.push('weights must include at least one opportunity');
  if (missingOpportunityIds.length > 0) errors.push('one or more opportunity ids are missing from the current catalogue');
  if (duplicateOpportunityIds.length > 0) errors.push('duplicate opportunity ids are not allowed');
  if (args.weights.some((weight) => !Number.isFinite(weight.weightPct) || weight.weightPct <= 0)) {
    errors.push('each weightPct must be a positive finite number');
  }
  if (amountUsd !== null && (!Number.isFinite(amountUsd) || amountUsd <= 0)) errors.push('amountUsd must be positive when provided');
  if (Math.abs(sum - 100) > 0.01) warnings.push('weights do not sum to 100%');

  return allocationValidationOutputSchema.parse({
    status: errors.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ok',
    totalWeightPct: sum,
    amountUsd,
    warnings,
    errors,
    missingOpportunityIds: [...new Set(missingOpportunityIds)].sort(),
    duplicateOpportunityIds
  });
}

export async function calculateBlendedApy(config: AppConfig, args: AllocationWeightsArgs) {
  const { catalogue, byId } = await loadSelected(config, {
    refresh: args.refresh,
    opportunityIds: args.weights.map((weight) => weight.opportunityId)
  });
  const components = allocationComponents(args.weights, byId).map(({ weight, opportunity }) => {
    const apyPct = opportunity.apy.current * 100;
    return {
      opportunityId: opportunity.id,
      title: opportunity.title,
      venue: opportunity.venue,
      weightPct: weight.weightPct,
      apyPct: round2(apyPct),
      contributionPct: round4((weight.weightPct / 100) * apyPct)
    };
  });

  return blendedApyOutputSchema.parse({
    blendedApyPct: round2(components.reduce((sum, component) => sum + component.contributionPct, 0)),
    weights: args.weights,
    components,
    generated_at: catalogue.generated_at
  });
}

export async function calculateBlendedRisk(config: AppConfig, args: AllocationWeightsArgs) {
  const { catalogue, byId } = await loadSelected(config, {
    refresh: args.refresh,
    opportunityIds: args.weights.map((weight) => weight.opportunityId)
  });
  const components = allocationComponents(args.weights, byId).map(({ weight, opportunity }) => ({
    opportunityId: opportunity.id,
    title: opportunity.title,
    venue: opportunity.venue,
    weightPct: weight.weightPct,
    riskScore: opportunity.risk.score,
    riskTier: opportunity.risk.tier,
    contribution: round4((weight.weightPct / 100) * opportunity.risk.score)
  }));
  const blendedRiskScore = Math.round(components.reduce((sum, component) => sum + component.contribution, 0));

  return blendedRiskOutputSchema.parse({
    blendedRiskScore,
    riskEnvelope: riskEnvelope(blendedRiskScore),
    weights: args.weights,
    components,
    generated_at: catalogue.generated_at
  });
}

export async function calculateConcentration(config: AppConfig, args: AllocationWeightsArgs) {
  const { catalogue, byId } = await loadSelected(config, {
    refresh: args.refresh,
    opportunityIds: args.weights.map((weight) => weight.opportunityId)
  });
  const entries = allocationComponents(args.weights, byId);
  const byVenue = groupWeights(
    entries.map(({ weight, opportunity }) => ({ key: opportunity.venue, weightPct: weight.weightPct })),
    'venue'
  );
  const byProductType = groupWeights(
    entries.map(({ weight, opportunity }) => ({ key: opportunity.product_type, weightPct: weight.weightPct })),
    'productType'
  );
  const byIntegrationStatus = groupWeights(
    entries.map(({ weight, opportunity }) => ({ key: opportunity.integrationStatus, weightPct: weight.weightPct })),
    'integrationStatus'
  );
  const byOpportunity = entries
    .map(({ weight, opportunity }) => ({
      opportunityId: opportunity.id,
      title: opportunity.title,
      venue: opportunity.venue,
      weightPct: weight.weightPct
    }))
    .sort((a, b) => b.weightPct - a.weightPct || a.opportunityId.localeCompare(b.opportunityId));

  return concentrationOutputSchema.parse({
    totalWeightPct: totalWeight(args.weights),
    maxVenueWeightPct: byVenue[0]?.weightPct ?? 0,
    maxProductTypeWeightPct: byProductType[0]?.weightPct ?? 0,
    maxOpportunityWeightPct: byOpportunity[0]?.weightPct ?? 0,
    byVenue,
    byProductType,
    byIntegrationStatus,
    byOpportunity,
    generated_at: catalogue.generated_at
  });
}

export async function calculateRebalanceDelta(config: AppConfig, args: RebalanceDeltaArgs) {
  const ids = [...new Set([...args.currentWeights, ...args.targetWeights].map((weight) => weight.opportunityId))].sort();
  const { catalogue, byId } = await loadSelected(config, { refresh: args.refresh, opportunityIds: ids });
  const currentById = new Map(args.currentWeights.map((weight) => [weight.opportunityId, weight.weightPct]));
  const targetById = new Map(args.targetWeights.map((weight) => [weight.opportunityId, weight.weightPct]));
  const amountUsd = args.amountUsd === undefined ? null : Number(args.amountUsd);

  const deltas = ids.map((opportunityId) => {
    const currentWeightPct = currentById.get(opportunityId) ?? 0;
    const targetWeightPct = targetById.get(opportunityId) ?? 0;
    const deltaWeightPct = round4(targetWeightPct - currentWeightPct);
    const opportunity = byId.get(opportunityId);
    return {
      opportunityId,
      title: opportunity?.title ?? null,
      venue: opportunity?.venue ?? null,
      currentWeightPct,
      targetWeightPct,
      deltaWeightPct,
      currentAmountUsd: amountUsd === null ? null : round2((currentWeightPct / 100) * amountUsd),
      targetAmountUsd: amountUsd === null ? null : round2((targetWeightPct / 100) * amountUsd),
      deltaAmountUsd: amountUsd === null ? null : round2((deltaWeightPct / 100) * amountUsd)
    };
  });

  return rebalanceDeltaOutputSchema.parse({
    amountUsd: amountUsd === null || !Number.isFinite(amountUsd) ? null : amountUsd,
    totalCurrentWeightPct: totalWeight(args.currentWeights),
    totalTargetWeightPct: totalWeight(args.targetWeights),
    deltas,
    generated_at: catalogue.generated_at
  });
}
