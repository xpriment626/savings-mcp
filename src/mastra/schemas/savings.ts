import { z } from 'zod';

export const riskTierSchema = z.enum(['conservative', 'moderate', 'elevated', 'high']);
export const riskPreferenceSchema = z.enum(['conservative', 'balanced', 'aggressive']);
export const allocationNudgeSchema = z.enum(['more_conservative', 'more_aggressive', 'fewer_pools']);
export const productTypeSchema = z.enum(['lending_reserve', 'vault']);
export const withdrawalModeSchema = z.enum(['instant', 'debt_ceiling', 'buffer', 'epoch', 'lp_exit', 'unknown']);

export const savingsAssetSchema = z.object({
  symbol: z.literal('USDC'),
  mint: z.string(),
  principal: z.literal('canonical_solana_usdc')
});

export const opportunityEvidenceSchema = z.object({
  label: z.string(),
  url: z.string(),
  observedAt: z.string()
});

export const savingsOpportunitySchema = z.object({
  id: z.string(),
  venue: z.string(),
  protocol: z.string(),
  product_type: productTypeSchema,
  title: z.string(),
  asset: savingsAssetSchema,
  apy: z.object({
    current: z.number(),
    source: z.string(),
    window: z.string()
  }),
  tvl: z.object({ usd: z.number() }),
  liquidity: z.object({
    utilizationPct: z.number().nullable(),
    withdrawalBufferPct: z.number().nullable()
  }),
  risk: z.object({
    tier: riskTierSchema,
    score: z.number(),
    factors: z.array(z.string()),
    synthesis: z.string()
  }),
  flags: z.object({
    depositable: z.boolean(),
    simulatable: z.boolean()
  }),
  refs: z.object({
    market: z.string().optional(),
    reserve: z.string().optional(),
    vault: z.string().optional(),
    assetMint: z.string().optional()
  }),
  evidence: z.array(opportunityEvidenceSchema),
  generated_at: z.string()
});

export const savingsCatalogueSchema = z.object({
  asset: savingsAssetSchema,
  generated_at: z.string(),
  source: z.object({
    venue: z.string(),
    mode: z.enum(['fixture', 'live']),
    baseUrl: z.string().optional()
  }),
  opportunities: z.array(savingsOpportunitySchema)
});

export const searchUsdcOpportunitiesInputSchema = z.object({
  refresh: z.boolean().optional(),
  limit: z.number().optional(),
  minTvlUsd: z.number().optional(),
  productTypes: z.array(productTypeSchema).optional()
});

export const compareOpportunitiesInputSchema = z.object({
  opportunityIds: z.array(z.string()).optional(),
  refresh: z.boolean().optional()
});

export const proposeAllocationInputSchema = z.object({
  opportunityIds: z.array(z.string()),
  amountUsd: z.number().positive(),
  riskPreference: riskPreferenceSchema.optional(),
  nudges: z.array(allocationNudgeSchema).optional(),
  refresh: z.boolean().optional()
});

export const allocationWeightSchema = z.object({
  opportunityId: z.string(),
  title: z.string(),
  venue: z.string(),
  productType: productTypeSchema,
  riskTier: riskTierSchema,
  weightPct: z.number(),
  apy: z.number()
});

export const allocationOutputSchema = z.object({
  mandate: z.object({
    opportunityIds: z.array(z.string()),
    amountUsd: z.number(),
    riskPreference: riskPreferenceSchema,
    nudges: z.array(allocationNudgeSchema)
  }),
  allocation: z.object({
    weights: z.array(allocationWeightSchema),
    blendedApyPct: z.number(),
    blendedRiskScore: z.number(),
    riskEnvelope: z.string(),
    rebalanceStrategy: z.string(),
    rationale: z.string()
  }),
  generated_at: z.string()
});

export const metricPacketInputSchema = z.object({
  opportunityId: z.string(),
  refresh: z.boolean().optional()
});

export const metricPacketSchema = z.object({
  opportunityId: z.string(),
  venue: z.string(),
  protocol: z.string(),
  productType: productTypeSchema,
  fetchedAt: z.string(),
  rate: z.object({
    currentApy: z.number(),
    source: z.string(),
    window: z.string(),
    baseApy: z.number().optional(),
    rewardsApy: z.number().optional()
  }),
  scale: z.object({
    tvlUsd: z.number(),
    totalAssetsBaseUnits: z.string().optional(),
    totalSupplyBaseUnits: z.string().optional()
  }),
  liquidity: z.object({
    utilizationPct: z.number().nullable(),
    withdrawalBufferPct: z.number().nullable(),
    withdrawalMode: withdrawalModeSchema,
    withdrawableBaseUnits: z.string().optional(),
    withdrawalLimitBaseUnits: z.string().optional()
  }),
  riskInputs: z.object({
    tier: riskTierSchema,
    score: z.number(),
    factors: z.array(z.string()),
    synthesis: z.string(),
    venueSpecific: z.record(z.string(), z.unknown())
  }),
  receipt: z.object({
    mint: z.string().optional(),
    symbol: z.string().optional(),
    exchangeRate: z.string().optional()
  }),
  flags: z.object({
    depositable: z.boolean(),
    simulatable: z.boolean(),
    requiresKyc: z.boolean(),
    accessGated: z.boolean(),
    hasLpExposure: z.boolean(),
    usesExternalStrategies: z.boolean()
  }),
  evidence: z.array(opportunityEvidenceSchema)
});

export const dataQualityInputSchema = z.object({
  refresh: z.boolean().optional(),
  opportunityIds: z.array(z.string()).optional()
});

export const dataQualityReportSchema = z.object({
  checkedAt: z.string(),
  mode: z.enum(['fixture', 'live']),
  warnings: z.array(z.string()),
  opportunityReports: z.array(
    z.object({
      opportunityId: z.string(),
      status: z.enum(['ok', 'warning']),
      warnings: z.array(z.string()),
      evidenceCount: z.number()
    })
  )
});

export const rateQualityAnalysisSchema = z.object({
  summary: z.string(),
  opportunityId: z.string(),
  baseYield: z.string().optional(),
  rewardYield: z.string().optional(),
  stabilityNote: z.string(),
  confidence: z.enum(['low', 'medium', 'high'])
});

export const exitLiquidityAnalysisSchema = z.object({
  summary: z.string(),
  opportunityId: z.string(),
  withdrawalMode: withdrawalModeSchema,
  risks: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high'])
});

export const allocationWorkflowInputSchema = proposeAllocationInputSchema;

export const allocationWorkflowOutputSchema = z.object({
  catalogue: savingsCatalogueSchema,
  allocation: allocationOutputSchema,
  metricPackets: z.array(metricPacketSchema),
  dataQuality: dataQualityReportSchema
});

export type MetricPacket = z.infer<typeof metricPacketSchema>;
export type DataQualityReport = z.infer<typeof dataQualityReportSchema>;
