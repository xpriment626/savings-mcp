import {
  historicalComparisonOutputSchema,
  historicalLiquidityRiskOutputSchema,
  historyAnalyticsInputSchema,
  historyAnomalyOutputSchema,
  historyQualityOutputSchema,
  historySampleSchemaOutputSchema,
  historyValidationOutputSchema,
  rateStabilityOutputSchema,
  yieldPercentilesOutputSchema
} from './core/schemas.js';
import type {
  HistoryAnalyticsInput,
  HistoryComparisonInput,
  HistorySample,
  OpportunityHistorySummary,
  RateStability
} from './core/schemas.js';

type HistoryMode = 'samples' | 'summary';

const DAY_MS = 86_400_000;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteNumbers(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => Number.isFinite(value));
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function min(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function max(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function timestamps(samples: readonly HistorySample[]): number[] {
  return samples
    .map((sample) => Date.parse(sample.timestamp))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
}

function sortedSamples(samples: readonly HistorySample[]): HistorySample[] {
  return [...samples].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function windowDaysFromSamples(samples: readonly HistorySample[]): number {
  const times = timestamps(samples);
  if (times.length < 2) return times.length === 1 ? 1 : 0;
  return round2(((times[times.length - 1] ?? 0) - (times[0] ?? 0)) / DAY_MS);
}

function normalizeInput(input: unknown): {
  parsed: HistoryAnalyticsInput | null;
  samples: HistorySample[];
  summary: OpportunityHistorySummary | null;
  mode: HistoryMode | 'empty';
  errors: string[];
} {
  const parsed = historyAnalyticsInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      parsed: null,
      samples: [],
      summary: null,
      mode: 'empty',
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    };
  }

  const samples = parsed.data.samples ?? parsed.data.series?.samples ?? [];
  const summary = parsed.data.summary ?? null;
  const mode = samples.length > 0 ? 'samples' : summary ? 'summary' : 'empty';
  return { parsed: parsed.data, samples, summary, mode, errors: [] };
}

function opportunityIds(samples: readonly HistorySample[], summary: OpportunityHistorySummary | null): string[] {
  const ids = new Set<string>();
  for (const sample of samples) ids.add(sample.opportunityId);
  if (summary) ids.add(summary.opportunityId);
  return [...ids].sort();
}

function primaryOpportunityId(samples: readonly HistorySample[], summary: OpportunityHistorySummary | null): string {
  return samples[0]?.opportunityId ?? summary?.opportunityId ?? 'unknown';
}

function validateSampleShape(samples: readonly HistorySample[]): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const ids = opportunityIds(samples, null);

  if (ids.length > 1) warnings.push('samples include multiple opportunity ids');
  for (const sample of samples) {
    if (!Number.isFinite(Date.parse(sample.timestamp))) errors.push(`${sample.opportunityId}: invalid timestamp ${sample.timestamp}`);
    if (sample.apy !== undefined && !Number.isFinite(sample.apy)) errors.push(`${sample.opportunityId}: APY is not finite`);
    if (sample.tvlUsd !== undefined && !Number.isFinite(sample.tvlUsd)) errors.push(`${sample.opportunityId}: TVL is not finite`);
  }
  return { warnings, errors };
}

function requireSamples(input: unknown): HistorySample[] {
  const normalized = normalizeInput(input);
  if (normalized.errors.length > 0) throw new Error(normalized.errors.join('; '));
  if (normalized.samples.length === 0) throw new Error('history samples are required for this calculation');
  return sortedSamples(normalized.samples);
}

function requireSamplesOrSummary(input: unknown): { mode: HistoryMode; samples: HistorySample[]; summary: OpportunityHistorySummary | null } {
  const normalized = normalizeInput(input);
  if (normalized.errors.length > 0) throw new Error(normalized.errors.join('; '));
  if (normalized.mode === 'empty') throw new Error('history samples or a precomputed summary are required');
  return {
    mode: normalized.mode,
    samples: sortedSamples(normalized.samples),
    summary: normalized.summary
  };
}

function rateStatsFromSamples(samples: readonly HistorySample[]) {
  const apys = finiteNumbers(samples.map((sample) => sample.apy));
  if (apys.length === 0) throw new Error('at least one APY sample is required');
  const avg = mean(apys);
  const sd = stdDev(apys);
  const cv = avg === 0 ? 0 : Math.abs(sd / avg);
  return {
    sampleCount: samples.length,
    windowDays: windowDaysFromSamples(samples),
    meanApy: round4(avg),
    stdDevApy: round4(sd),
    minApy: min(apys),
    maxApy: max(apys),
    p10Apy: nearestRank(apys, 10),
    p25Apy: nearestRank(apys, 25),
    p50Apy: nearestRank(apys, 50),
    p75Apy: nearestRank(apys, 75),
    p90Apy: nearestRank(apys, 90),
    coefficientOfVariation: round4(cv)
  };
}

function regimeFor(coefficientOfVariation: number): RateStability['regime'] {
  if (coefficientOfVariation <= 0.15) return 'stable';
  if (coefficientOfVariation <= 0.5) return 'variable';
  return 'volatile';
}

function stabilityScoreFor(coefficientOfVariation: number, rangePct: number): number {
  return Math.max(0, round2(100 - coefficientOfVariation * 220 - Math.max(0, rangePct) * 120));
}

function liquidityRiskLevel(input: {
  utilizationMaxPct: number | null;
  withdrawalBufferMinPct: number | null;
}): 'low' | 'medium' | 'high' {
  if (input.withdrawalBufferMinPct !== null && input.withdrawalBufferMinPct <= 10) return 'high';
  if (input.utilizationMaxPct !== null && input.utilizationMaxPct >= 90) return 'high';
  if (input.withdrawalBufferMinPct !== null && input.withdrawalBufferMinPct <= 20) return 'medium';
  if (input.utilizationMaxPct !== null && input.utilizationMaxPct >= 80) return 'medium';
  return 'low';
}

export function getHistorySampleSchema() {
  return historySampleSchemaOutputSchema.parse({
    sample: {
      type: 'object',
      required: ['opportunityId', 'timestamp'],
      properties: {
        opportunityId: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
        apy: { type: 'number', description: 'Decimal APY, for example 0.042 for 4.2%.' },
        tvlUsd: { type: 'number' },
        utilizationPct: { type: 'number' },
        withdrawalBufferPct: { type: 'number' },
        source: { type: 'string' }
      }
    },
    summary: {
      type: 'object',
      required: ['opportunityId', 'sampleCount', 'windowDays', 'apyMean', 'apyStdDev', 'apyMin', 'apyMax'],
      properties: {
        opportunityId: { type: 'string' },
        sampleCount: { type: 'number' },
        windowDays: { type: 'number' },
        apyMean: { type: 'number' },
        apyStdDev: { type: 'number' },
        apyMin: { type: 'number' },
        apyMax: { type: 'number' },
        apyP10: { type: 'number' },
        apyP50: { type: 'number' },
        apyP90: { type: 'number' },
        tvlMeanUsd: { type: 'number' },
        utilizationMeanPct: { type: 'number' },
        withdrawalBufferMinPct: { type: 'number' },
        source: { type: 'string' }
      }
    }
  });
}

export function validateHistorySamples(input: unknown) {
  const normalized = normalizeInput(input);
  const warnings: string[] = [];
  const errors = [...normalized.errors];

  if (normalized.mode === 'empty') errors.push('provide samples, series.samples, or summary');
  if (normalized.samples.length > 0) {
    const sampleReport = validateSampleShape(normalized.samples);
    warnings.push(...sampleReport.warnings);
    errors.push(...sampleReport.errors);
  }
  if (normalized.summary && normalized.summary.sampleCount <= 0) errors.push('summary sampleCount must be positive');
  if (normalized.parsed?.series?.opportunityId) {
    const mismatched = normalized.samples.filter((sample) => sample.opportunityId !== normalized.parsed?.series?.opportunityId);
    if (mismatched.length > 0) warnings.push('series opportunityId does not match every sample opportunityId');
  }

  return historyValidationOutputSchema.parse({
    status: errors.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ok',
    mode: normalized.mode,
    sampleCount: normalized.samples.length || normalized.summary?.sampleCount || 0,
    opportunityIds: opportunityIds(normalized.samples, normalized.summary),
    warnings,
    errors
  });
}

export function summarizeHistoryQuality(input: unknown) {
  const { mode, samples, summary } = requireSamplesOrSummary(input);
  if (mode === 'summary' && summary) {
    const qualityScore = Math.max(0, Math.min(100, summary.sampleCount >= 30 ? 85 : 65));
    return historyQualityOutputSchema.parse({
      mode,
      opportunityId: summary.opportunityId,
      coverage: {
        sampleCount: summary.sampleCount,
        startTimestamp: null,
        endTimestamp: null,
        windowDays: summary.windowDays
      },
      completeness: {
        apySamples: summary.sampleCount,
        tvlSamples: summary.tvlMeanUsd === undefined ? 0 : summary.sampleCount,
        utilizationSamples: summary.utilizationMeanPct === undefined ? 0 : summary.sampleCount,
        withdrawalBufferSamples: summary.withdrawalBufferMinPct === undefined ? 0 : summary.sampleCount
      },
      warnings: ['summary mode trusts integrator-provided aggregate statistics'],
      qualityScore
    });
  }

  const times = timestamps(samples);
  const apySamples = finiteNumbers(samples.map((sample) => sample.apy)).length;
  const tvlSamples = finiteNumbers(samples.map((sample) => sample.tvlUsd)).length;
  const utilizationSamples = finiteNumbers(samples.map((sample) => sample.utilizationPct)).length;
  const withdrawalBufferSamples = finiteNumbers(samples.map((sample) => sample.withdrawalBufferPct)).length;
  const warnings: string[] = [];
  if (samples.length < 3) warnings.push('short history window');
  if (apySamples < samples.length) warnings.push('one or more APY samples are missing');
  if (times.length < samples.length) warnings.push('one or more timestamps are invalid');
  const startTime = times[0];
  const endTime = times[times.length - 1];

  return historyQualityOutputSchema.parse({
    mode,
    opportunityId: primaryOpportunityId(samples, null),
    coverage: {
      sampleCount: samples.length,
      startTimestamp: startTime === undefined ? null : new Date(startTime).toISOString(),
      endTimestamp: endTime === undefined ? null : new Date(endTime).toISOString(),
      windowDays: windowDaysFromSamples(samples)
    },
    completeness: {
      apySamples,
      tvlSamples,
      utilizationSamples,
      withdrawalBufferSamples
    },
    warnings,
    qualityScore: Math.max(0, round2(100 - warnings.length * 15 - Math.max(0, 3 - samples.length) * 10))
  });
}

export function calculateRateStability(input: unknown) {
  const { mode, samples, summary } = requireSamplesOrSummary(input);
  const stats = summary
    ? {
        sampleCount: summary.sampleCount,
        windowDays: summary.windowDays,
        meanApy: summary.apyMean,
        stdDevApy: summary.apyStdDev,
        minApy: summary.apyMin,
        maxApy: summary.apyMax,
        p10Apy: summary.apyP10 ?? summary.apyMin,
        p50Apy: summary.apyP50 ?? summary.apyMean,
        p90Apy: summary.apyP90 ?? summary.apyMax,
        coefficientOfVariation: summary.apyMean === 0 ? 0 : Math.abs(summary.apyStdDev / summary.apyMean)
      }
    : rateStatsFromSamples(samples);
  const rangePct = stats.meanApy === 0 ? 0 : Math.abs((stats.maxApy - stats.minApy) / stats.meanApy);
  const cv = round4(stats.coefficientOfVariation);

  return rateStabilityOutputSchema.parse({
    mode,
    opportunityId: primaryOpportunityId(samples, summary),
    sampleCount: stats.sampleCount,
    windowDays: stats.windowDays,
    meanApy: round4(stats.meanApy),
    stdDevApy: round4(stats.stdDevApy),
    minApy: stats.minApy,
    maxApy: stats.maxApy,
    p10Apy: stats.p10Apy,
    p50Apy: stats.p50Apy,
    p90Apy: stats.p90Apy,
    coefficientOfVariation: cv,
    regime: regimeFor(cv),
    stabilityScore: stabilityScoreFor(cv, rangePct)
  });
}

export function calculateYieldPercentiles(input: unknown) {
  const { mode, samples, summary } = requireSamplesOrSummary(input);
  const stats = summary
    ? {
        sampleCount: summary.sampleCount,
        p10Apy: summary.apyP10 ?? summary.apyMin,
        p25Apy: summary.apyMin,
        p50Apy: summary.apyP50 ?? summary.apyMean,
        p75Apy: summary.apyMax,
        p90Apy: summary.apyP90 ?? summary.apyMax,
        minApy: summary.apyMin,
        maxApy: summary.apyMax
      }
    : rateStatsFromSamples(samples);

  return yieldPercentilesOutputSchema.parse({
    mode,
    opportunityId: primaryOpportunityId(samples, summary),
    sampleCount: stats.sampleCount,
    p10Apy: stats.p10Apy,
    p25Apy: stats.p25Apy,
    p50Apy: stats.p50Apy,
    p75Apy: stats.p75Apy,
    p90Apy: stats.p90Apy,
    minApy: stats.minApy,
    maxApy: stats.maxApy
  });
}

export function calculateHistoricalLiquidityRisk(input: unknown) {
  const { mode, samples, summary } = requireSamplesOrSummary(input);
  const utilizations = finiteNumbers(samples.map((sample) => sample.utilizationPct));
  const buffers = finiteNumbers(samples.map((sample) => sample.withdrawalBufferPct));
  const utilizationMeanPct = summary?.utilizationMeanPct ?? (utilizations.length === 0 ? null : mean(utilizations));
  const utilizationMaxPct = utilizations.length === 0 ? utilizationMeanPct : max(utilizations);
  const withdrawalBufferMinPct = summary?.withdrawalBufferMinPct ?? (buffers.length === 0 ? null : min(buffers));
  const withdrawalBufferMeanPct = buffers.length === 0 ? withdrawalBufferMinPct : mean(buffers);
  const riskLevel = liquidityRiskLevel({ utilizationMaxPct, withdrawalBufferMinPct });
  const warnings: string[] = [];
  if (withdrawalBufferMinPct !== null && withdrawalBufferMinPct <= 10) warnings.push('historical withdrawal buffer reached 10% or lower');
  if (utilizationMaxPct !== null && utilizationMaxPct >= 90) warnings.push('historical utilization reached 90% or higher');
  if (utilizations.length === 0 && summary?.utilizationMeanPct === undefined) warnings.push('historical utilization data is missing');
  if (buffers.length === 0 && summary?.withdrawalBufferMinPct === undefined) warnings.push('historical withdrawal-buffer data is missing');

  return historicalLiquidityRiskOutputSchema.parse({
    mode,
    opportunityId: primaryOpportunityId(samples, summary),
    sampleCount: samples.length || summary?.sampleCount || 0,
    riskLevel,
    utilization: {
      meanPct: utilizationMeanPct === null ? null : round2(utilizationMeanPct),
      maxPct: utilizationMaxPct === null ? null : round2(utilizationMaxPct)
    },
    withdrawalBuffer: {
      minPct: withdrawalBufferMinPct === null ? null : round2(withdrawalBufferMinPct),
      meanPct: withdrawalBufferMeanPct === null ? null : round2(withdrawalBufferMeanPct)
    },
    warnings
  });
}

export function detectHistoryAnomalies(input: unknown) {
  const samples = requireSamples(input);
  const anomalies = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) continue;

    if (previous.apy !== undefined && current.apy !== undefined) {
      const delta = current.apy - previous.apy;
      if (delta >= 0.05 || (previous.apy > 0 && current.apy / previous.apy >= 2)) {
        anomalies.push({
          type: 'apy_spike' as const,
          timestamp: current.timestamp,
          previousTimestamp: previous.timestamp,
          severity: delta >= 0.1 ? 'high' : 'medium',
          details: `APY increased from ${previous.apy} to ${current.apy}`
        });
      }
      if (delta <= -0.05) {
        anomalies.push({
          type: 'apy_drop' as const,
          timestamp: current.timestamp,
          previousTimestamp: previous.timestamp,
          severity: Math.abs(delta) >= 0.1 ? 'high' : 'medium',
          details: `APY decreased from ${previous.apy} to ${current.apy}`
        });
      }
    }

    if (previous.tvlUsd !== undefined && current.tvlUsd !== undefined && previous.tvlUsd > 0) {
      const tvlDeltaPct = ((current.tvlUsd - previous.tvlUsd) / previous.tvlUsd) * 100;
      if (tvlDeltaPct <= -25) {
        anomalies.push({
          type: 'tvl_drop' as const,
          timestamp: current.timestamp,
          previousTimestamp: previous.timestamp,
          severity: tvlDeltaPct <= -40 ? 'high' : 'medium',
          details: `TVL dropped ${round2(Math.abs(tvlDeltaPct))}%`
        });
      }
    }

    if (
      previous.withdrawalBufferPct !== undefined &&
      previous.withdrawalBufferPct !== null &&
      current.withdrawalBufferPct !== undefined &&
      current.withdrawalBufferPct !== null &&
      previous.withdrawalBufferPct > 15 &&
      current.withdrawalBufferPct <= 10
    ) {
      anomalies.push({
        type: 'withdrawal_buffer_drop' as const,
        timestamp: current.timestamp,
        previousTimestamp: previous.timestamp,
        severity: 'high' as const,
        details: `Withdrawal buffer dropped from ${previous.withdrawalBufferPct}% to ${current.withdrawalBufferPct}%`
      });
    }

    if (
      previous.utilizationPct !== undefined &&
      previous.utilizationPct !== null &&
      current.utilizationPct !== undefined &&
      current.utilizationPct !== null &&
      current.utilizationPct >= 90 &&
      current.utilizationPct - previous.utilizationPct >= 15
    ) {
      anomalies.push({
        type: 'utilization_spike' as const,
        timestamp: current.timestamp,
        previousTimestamp: previous.timestamp,
        severity: 'high' as const,
        details: `Utilization rose from ${previous.utilizationPct}% to ${current.utilizationPct}%`
      });
    }
  }

  return historyAnomalyOutputSchema.parse({
    opportunityId: primaryOpportunityId(samples, null),
    anomalies
  });
}

export function compareHistoricalOpportunities(input: HistoryComparisonInput) {
  const comparison = input.histories.map((history) => {
    const stability = calculateRateStability(history);
    const liquidity = calculateHistoricalLiquidityRisk(history);
    const anomalies = normalizeInput(history).samples.length > 0 ? detectHistoryAnomalies(history).anomalies : [];
    return {
      opportunityId: stability.opportunityId,
      sampleCount: stability.sampleCount,
      regime: stability.regime,
      meanApy: stability.meanApy,
      p50Apy: stability.p50Apy,
      p90Apy: stability.p90Apy,
      liquidityRiskLevel: liquidity.riskLevel,
      anomalyCount: anomalies.length,
      stabilityScore: stability.stabilityScore
    };
  });

  const riskOrder = { low: 0, medium: 1, high: 2 };
  comparison.sort(
    (a, b) =>
      b.stabilityScore - a.stabilityScore ||
      riskOrder[a.liquidityRiskLevel] - riskOrder[b.liquidityRiskLevel] ||
      b.meanApy - a.meanApy ||
      a.opportunityId.localeCompare(b.opportunityId)
  );

  return historicalComparisonOutputSchema.parse({ comparison });
}
