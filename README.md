# Savings MCP

Agent-native USDC savings surface for Solana. The v0 server exposes a raw JSON-RPC MCP endpoint with Kamino-backed canonical USDC opportunity discovery, comparison, and deterministic allocation previews.

The current scope is read-only:

- canonical Solana USDC only: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Kamino is the first venue
- allocation weights are deterministic library math
- execution, signing, and deposit simulation are not wired yet

## Pure Infra Boundary

Savings MCP produces portable payloads that an integrating app, agent runtime, wallet, or backend can decide how to use.

This repo owns:

- venue adapters and normalized USDC opportunity data
- deterministic comparison, scoring, and allocation helpers
- schema-checked payloads for metrics, analysis, and allocation previews
- MCP tools and Mastra tools that expose those deterministic helpers

Integrating applications own:

- users, auth, sessions, and wallet provisioning
- signatures, transaction submission, and custody decisions
- ledgers, balances, account histories, and UI state
- fee policy and production routing orchestration

## Mastra Layer

Mastra is wired as a parallel agent/workflow layer over the deterministic savings library.

Folder map:

- `src/core/schemas.ts`: canonical zod schemas for opportunities, metric packets, data quality, allocation inputs/outputs, and workflow payloads.
- `src/core/metrics.ts`: deterministic metric packet, data-quality, and eligibility helpers.
- `src/core/analysis.ts`: deterministic specialist analysis and narration helpers.
- `src/core/tool-args.ts`: shared zod-backed argument parsing for raw MCP and Mastra tools.
- `src/mastra/tools/index.ts`: thin Mastra tool wrappers around deterministic library functions.
- `src/mastra/agents/metric-specialists.ts`: structured-output Mastra metric specialist definitions over normalized payloads.
- `src/mastra/schemas/savings.ts`: compatibility re-export for the canonical core schemas.
- `src/mastra/workflows/analyze-savings-allocation.ts`: `analyzeSavingsAllocationWorkflow` and deterministic app/script runner.
- `src/mastra/mcp-server.ts`: parallel Mastra `MCPServer` exposing tools and workflow.
- `src/mastra/index.ts`: public exports for the Mastra surface.

Current tools:

- `searchUsdcOpportunitiesTool`
- `compareOpportunitiesTool`
- `proposeAllocationTool`
- `getMetricPacketTool`
- `analyzeDataQualityTool`

The Mastra layer does not add auth, wallet signing, account persistence, transaction sending, or user ledgers.

### Metric Specialist Agents

The first specialist agents consume `metricPacketSchema`, allocation outputs, and other normalized Savings MCP payloads only.

- `RateQualityAgent`: APY source/window, base versus rewards, stability confidence, and missing history.
- `ExitLiquidityAgent`: withdrawal mode, utilization, buffers, debt-ceiling notes, LP exit notes, and exit risk level.
- `CapacityUtilizationAgent`: TVL, utilization, depositability, caps/unavailability, and thin or fragmented venue warnings.
- `StrategyExposureAgent`: managed vaults, external strategy routing, Kamino Earn/Meteora notes, and LP exposure flags.
- `VenueRiskDecomposerAgent`: specialist-output synthesis into comparable venue/product risk.
- `StrategyNarratorAgent`: narration for fixed deterministic allocations; it never changes weights.

Each agent exports a zod `outputSchema`. Fixture-mode tests use a stable deterministic harness so no live model call is required.

### Allocation Analysis Workflow

`analyzeSavingsAllocationWorkflow` composes the Savings MCP tools and metric specialists into one portable payload for integrating apps.

Input:

- `opportunityIds`
- `amountUsd`
- `riskPreference`
- `nudges?`
- `refresh?`

Output:

- selected opportunities
- deterministic data-quality and eligibility reports
- deterministic allocation
- metric packets
- specialist analyses
- comparable venue risk decomposition
- fixed-weight strategy narration
- explicit external-integrator boundaries for auth, signing, transaction sending, and user ledgers

The parallel Mastra MCP surface is available from `createSavingsMastraMcpServer(...)`; it exposes the Mastra tools plus `run_analyzeSavingsAllocationWorkflow`.

## Run

```bash
npm run dev
```

Endpoint:

```text
http://127.0.0.1:8788/mcp
```

## Contributor Tests

Run deterministic raw endpoint and Mastra workflow tests without leaving a server running:

```bash
npm test
npm run test:raw
npm run test:mastra-workflow
```

Internal one-off request scripts can live under ignored `scripts/`, but committed `package.json` commands only point at tracked contributor-runnable tests.

For fixture-mode local calls:

```bash
SAVINGS_USE_FIXTURE_CATALOGUE=1 npm run dev
```

## Env Pass From Fabrick

Needed now:

- `KAMINO_API_BASE_URL`, `KAMINO_REQUEST_TIMEOUT_MS`, `SAVINGS_CACHE_TTL_MS` are public catalogue knobs. Defaults work without secrets.

Needed when simulation / transaction prep is wired:

- `SOLANA_RPC_URL` or `HELIUS_API_KEY`

Optional for later agent/research work:

- `OPENROUTER_API_KEY`
- `EXA_API_KEY`
- `TOPLEDGER_API_KEY`
- `CORAL_SERVER_URL`
- `CORAL_AUTH_TOKEN`

Intentionally not ported from Fabrick v0:

- Privy keys: no auth or wallet substrate in this service yet
- Supabase/Turso keys: no persistence, event archive, or user profile store yet
- fleet gateway secrets: no browser fleet streaming path here
- Firecrawl/Jupiter/Birdeye keys: not used by the current Savings MCP surface
