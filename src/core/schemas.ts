import { z } from 'zod';

export const riskTierSchema = z.enum(['conservative', 'moderate', 'elevated', 'high']);
export const riskPreferenceSchema = z.enum(['conservative', 'balanced', 'aggressive']);
export const allocationNudgeSchema = z.enum(['more_conservative', 'more_aggressive', 'fewer_pools']);
export const productTypeSchema = z.enum(['lending_reserve', 'vault']);
export const withdrawalModeSchema = z.enum(['instant', 'debt_ceiling', 'buffer', 'epoch', 'lp_exit', 'unknown']);
export const confidenceSchema = z.enum(['low', 'medium', 'high']);
export const riskLevelSchema = z.enum(['low', 'medium', 'high']);

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

export const opportunityDisplaySchema = z.object({
  displayTitle: z.string(),
  headlineApyPct: z.number(),
  riskBadge: z.string(),
  liquidityBadge: z.string(),
  status: z.enum(['depositable', 'not_depositable', 'not_simulatable', 'needs_review']),
  primaryWarnings: z.array(z.string()),
  availableFollowups: z.array(z.string())
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
  display: opportunityDisplaySchema,
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
  opportunities: z.array(savingsOpportunitySchema),
  warnings: z.array(z.string()).optional(),
  venueReports: z
    .array(
      z.object({
        adapterId: z.string(),
        venue: z.string(),
        status: z.enum(['ok', 'warning', 'unavailable']),
        opportunityCount: z.number(),
        warnings: z.array(z.string())
      })
    )
    .optional()
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
  display: z.object({
    displayTitle: z.string(),
    headlineApyPct: z.number(),
    riskBadge: z.string(),
    status: z.literal('preview_only'),
    primaryWarnings: z.array(z.string()),
    availableFollowups: z.array(z.string())
  }),
  generated_at: z.string()
});

export const compareOpportunitySchema = z.object({
  id: z.string(),
  title: z.string(),
  venue: z.string(),
  product_type: productTypeSchema,
  apy: savingsOpportunitySchema.shape.apy,
  tvl: savingsOpportunitySchema.shape.tvl,
  liquidity: savingsOpportunitySchema.shape.liquidity,
  risk: savingsOpportunitySchema.shape.risk,
  flags: savingsOpportunitySchema.shape.flags,
  evidence: z.array(opportunityEvidenceSchema),
  display: opportunityDisplaySchema
});

export const compareOpportunitiesOutputSchema = z.object({
  asset: savingsAssetSchema,
  generated_at: z.string(),
  comparison: z.array(compareOpportunitySchema)
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
  opportunityId: z.string(),
  summary: z.string(),
  apySource: z.string(),
  apyWindow: z.string(),
  currentApy: z.number(),
  baseApy: z.number().nullable(),
  rewardsApy: z.number().nullable(),
  missingHistory: z.boolean(),
  stabilityConfidence: confidenceSchema,
  warnings: z.array(z.string()),
  evidence: z.array(opportunityEvidenceSchema)
});

export const exitLiquidityAnalysisSchema = z.object({
  opportunityId: z.string(),
  summary: z.string(),
  withdrawalMode: withdrawalModeSchema,
  utilizationPct: z.number().nullable(),
  withdrawalBufferPct: z.number().nullable(),
  debtCeilingNote: z.string(),
  lpExitNote: z.string(),
  exitRiskLevel: riskLevelSchema,
  risks: z.array(z.string()),
  evidence: z.array(opportunityEvidenceSchema)
});

export const capacityUtilizationAnalysisSchema = z.object({
  opportunityId: z.string(),
  summary: z.string(),
  tvlUsd: z.number(),
  utilizationPct: z.number().nullable(),
  depositable: z.boolean(),
  simulatable: z.boolean(),
  capacitySignals: z.object({
    thinVenue: z.boolean(),
    highUtilization: z.boolean(),
    cappedOrUnavailable: z.boolean(),
    fragmentedLiquidity: z.boolean()
  }),
  warnings: z.array(z.string()),
  evidence: z.array(opportunityEvidenceSchema)
});

export const strategyExposureAnalysisSchema = z.object({
  opportunityId: z.string(),
  summary: z.string(),
  productType: productTypeSchema,
  usesExternalStrategies: z.boolean(),
  hasLpExposure: z.boolean(),
  exposureFlags: z.array(z.enum(['simple_reserve', 'managed_vault', 'external_strategy', 'lp_exposure'])),
  routingNotes: z.array(z.string()),
  warnings: z.array(z.string()),
  evidence: z.array(opportunityEvidenceSchema)
});

export const venueRiskDecompositionSchema = z.object({
  opportunityId: z.string(),
  venue: z.string(),
  protocol: z.string(),
  productType: productTypeSchema,
  comparableRiskTier: riskTierSchema,
  riskScore: z.number(),
  summary: z.string(),
  components: z.object({
    rateQuality: confidenceSchema,
    exitLiquidity: riskLevelSchema,
    capacity: riskLevelSchema,
    strategyExposure: riskLevelSchema
  }),
  warnings: z.array(z.string()),
  evidence: z.array(opportunityEvidenceSchema)
});

export const strategyNarrationSchema = z.object({
  summary: z.string(),
  allocationUnchanged: z.literal(true),
  riskEnvelope: z.string(),
  blendedApyPct: z.number(),
  blendedRiskScore: z.number(),
  weights: z.array(allocationWeightSchema),
  narration: z.string(),
  nonResponsibilities: z.array(z.string()),
  evidence: z.array(opportunityEvidenceSchema)
});

export const allocationWorkflowInputSchema = proposeAllocationInputSchema;

export const eligibilityReportSchema = z.object({
  status: z.enum(['ok', 'warning', 'blocked']),
  eligibleOpportunityIds: z.array(z.string()),
  ineligible: z.array(
    z.object({
      opportunityId: z.string(),
      reasons: z.array(z.string())
    })
  ),
  warnings: z.array(z.string())
});

export const opportunityAnalysisSchema = z.object({
  opportunityId: z.string(),
  metricPacket: metricPacketSchema,
  rateQuality: rateQualityAnalysisSchema,
  exitLiquidity: exitLiquidityAnalysisSchema,
  capacityUtilization: capacityUtilizationAnalysisSchema,
  strategyExposure: strategyExposureAnalysisSchema,
  venueRisk: venueRiskDecompositionSchema,
  evidence: z.array(opportunityEvidenceSchema)
});

export const workflowBoundarySchema = z.object({
  auth: z.literal('external_integrator'),
  signing: z.literal('external_integrator'),
  transactionSending: z.literal('external_integrator'),
  userLedger: z.literal('external_integrator')
});

export const analyzeSavingsAllocationWorkflowInputSchema = proposeAllocationInputSchema;

export const analyzeSavingsAllocationOutputSchema = z.object({
  kind: z.literal('savings.allocation.analysis'),
  version: z.literal('0.1.0'),
  generatedAt: z.string(),
  input: analyzeSavingsAllocationWorkflowInputSchema,
  asset: savingsAssetSchema,
  source: z.object({
    venue: z.string(),
    mode: z.enum(['fixture', 'live']),
    baseUrl: z.string().optional()
  }),
  selectedOpportunityIds: z.array(z.string()),
  selectedOpportunities: z.array(savingsOpportunitySchema),
  eligibility: eligibilityReportSchema,
  dataQuality: dataQualityReportSchema,
  allocation: allocationOutputSchema.nullable(),
  metricPackets: z.array(metricPacketSchema),
  opportunityAnalyses: z.array(opportunityAnalysisSchema),
  strategyNarration: strategyNarrationSchema.nullable(),
  boundaries: workflowBoundarySchema
});

export const allocationWorkflowOutputSchema = z.object({
  catalogue: savingsCatalogueSchema,
  allocation: allocationOutputSchema,
  metricPackets: z.array(metricPacketSchema),
  dataQuality: dataQualityReportSchema
});

export type MetricPacket = z.infer<typeof metricPacketSchema>;
export type DataQualityReport = z.infer<typeof dataQualityReportSchema>;
export type AllocationOutput = z.infer<typeof allocationOutputSchema>;
export type CompareOpportunitiesOutput = z.infer<typeof compareOpportunitiesOutputSchema>;
export type RateQualityAnalysis = z.infer<typeof rateQualityAnalysisSchema>;
export type ExitLiquidityAnalysis = z.infer<typeof exitLiquidityAnalysisSchema>;
export type CapacityUtilizationAnalysis = z.infer<typeof capacityUtilizationAnalysisSchema>;
export type StrategyExposureAnalysis = z.infer<typeof strategyExposureAnalysisSchema>;
export type VenueRiskDecomposition = z.infer<typeof venueRiskDecompositionSchema>;
export type StrategyNarration = z.infer<typeof strategyNarrationSchema>;
export type AnalyzeSavingsAllocationInput = z.infer<typeof analyzeSavingsAllocationWorkflowInputSchema>;
export type EligibilityReport = z.infer<typeof eligibilityReportSchema>;
export type OpportunityAnalysis = z.infer<typeof opportunityAnalysisSchema>;
export type AnalyzeSavingsAllocationOutput = z.infer<typeof analyzeSavingsAllocationOutputSchema>;
