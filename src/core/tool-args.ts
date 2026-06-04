import {
  compareOpportunitiesInputSchema,
  proposeAllocationInputSchema,
  searchUsdcOpportunitiesInputSchema
} from './schemas.js';
import type { CompareOpportunitiesArgs, FilterOpportunitiesArgs, ProposeAllocationArgs } from '../types.js';

function inputRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseFilterOpportunitiesArgs(value: unknown): FilterOpportunitiesArgs {
  const parsed = searchUsdcOpportunitiesInputSchema.parse(inputRecord(value));
  const args: FilterOpportunitiesArgs = {};
  if (parsed.refresh !== undefined) args.refresh = parsed.refresh;
  if (parsed.limit !== undefined) args.limit = parsed.limit;
  if (parsed.minTvlUsd !== undefined) args.minTvlUsd = parsed.minTvlUsd;
  if (parsed.productTypes !== undefined) args.productTypes = parsed.productTypes;
  return args;
}

export function parseCompareOpportunitiesArgs(value: unknown): CompareOpportunitiesArgs {
  const parsed = compareOpportunitiesInputSchema.parse(inputRecord(value));
  const args: CompareOpportunitiesArgs = {};
  if (parsed.opportunityIds !== undefined) args.opportunityIds = parsed.opportunityIds;
  if (parsed.refresh !== undefined) args.refresh = parsed.refresh;
  return args;
}

export function parseProposeAllocationArgs(value: unknown): ProposeAllocationArgs {
  const parsed = proposeAllocationInputSchema.parse(inputRecord(value));
  const args: ProposeAllocationArgs = {
    opportunityIds: parsed.opportunityIds,
    amountUsd: parsed.amountUsd
  };
  if (parsed.riskPreference !== undefined) args.riskPreference = parsed.riskPreference;
  if (parsed.nudges !== undefined) args.nudges = parsed.nudges;
  if (parsed.refresh !== undefined) args.refresh = parsed.refresh;
  return args;
}
