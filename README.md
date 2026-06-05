# Savings MCP

Agent-native USDC savings surface for Solana. The v0 server exposes a raw JSON-RPC MCP endpoint with canonical Solana USDC opportunity discovery, comparison, and deterministic allocation previews across supported venues.

The current scope is read-only:

- canonical Solana USDC only: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- supported venues: Kamino, Jupiter Lend, Save/Solend
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
- `src/core/display.ts`: deterministic display summaries for chat agents and lightweight app renderers.
- `src/core/metrics.ts`: deterministic metric packet, data-quality, and eligibility helpers.
- `src/core/analysis.ts`: deterministic specialist analysis and narration helpers.
- `src/core/tool-args.ts`: shared zod-backed argument parsing for raw MCP and Mastra tools.
- `src/venues/types.ts`: venue adapter contract for normalized USDC savings venues.
- `src/venues/kamino.ts`: Kamino adapter implementation for fixture/live USDC catalogue data.
- `src/venues/jupiter-lend.ts`: Jupiter Lend adapter implementation for fixture/live USDC Earn data.
- `src/venues/save-solend.ts`: Save/Solend adapter implementation for fixture/live USDC reserve data.
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
npm run typecheck
npm test
npm run test:raw
npm run test:mastra-workflow
```

Run live venue checks explicitly:

```bash
RUN_LIVE_VENUE_TESTS=1 npm run test:live
```

Without `RUN_LIVE_VENUE_TESTS=1`, `npm run test:live` skips clearly instead of hitting public venue APIs.

Internal one-off request scripts can live under ignored `scripts/`, but committed `package.json` commands only point at tracked contributor-runnable tests.

For fixture-mode local calls:

```bash
SAVINGS_USE_FIXTURE_CATALOGUE=1 npm run dev
```

For live local calls:

```bash
npm run dev
```

## ChatGPT/Codex Dev-Mode MCP Smoke

Use this after `npm run typecheck`, `npm test`, and `npm run test:raw` pass locally.

Start the server with fixture data:

```bash
SAVINGS_USE_FIXTURE_CATALOGUE=1 npm run dev
```

Connect your ChatGPT/Codex dev-mode MCP client to:

```text
http://127.0.0.1:8788/mcp
```

The raw MCP tools are read-only and return short `content` status text plus typed `structuredContent`. They do not authenticate users, provision wallets, sign, send transactions, custody funds, execute deposits/redemptions/rebalances, or maintain per-user ledgers.

Manual prompts for the first smoke session:

- “What USDC savings opportunities are available?”
- “Compare the Kamino lend and earn options.”
- “Allocate $5,000 conservatively across the available options.”
- “What risks or blocked states should I know about?”
- “Which fields should an integrating app store?”

Expected behavior:

- The chat agent discovers `get_usdc_opportunities`, `compare_opportunities`, and `propose_allocation`.
- The agent reasons from `structuredContent`, not by parsing JSON text from `content`.
- Opportunity responses include stable IDs, source/provenance, APY, TVL, liquidity, risk, flags, evidence, and `display` summaries.
- Fixture responses include Kamino, Jupiter Lend, and Save/Solend USDC opportunities.
- Live responses include per-venue `venueReports`; a temporarily unavailable venue is surfaced as a report/warning instead of crashing the whole catalogue.
- Allocation responses are explicitly preview-only and keep auth/signing/transaction/ledger responsibilities outside Savings MCP.
- Any warnings about depositability, simulation, managed vault exposure, or high utilization stay visible to the model.

Known live-data limitations:

- Jupiter Lend USDC Earn is normalized as a `vault`-style opportunity because it exposes jlUSDC receipt-token and debt-ceiling withdrawal mechanics, not a reserve-style utilization model. Utilization is `null`; withdrawal buffer reflects currently withdrawable assets when available.
- Save/Solend uses public market config and reserve detail endpoints for catalogue data. User obligation state is intentionally not read, so the adapter does not infer whether a user deposit is serving as collateral for liabilities.

## Env Pass From Fabrick

Needed now:

- `KAMINO_API_BASE_URL`, `JUPITER_LEND_API_BASE_URL`, `SAVE_SOLEND_API_BASE_URL`, `KAMINO_REQUEST_TIMEOUT_MS`, and `SAVINGS_CACHE_TTL_MS` are public catalogue knobs. Defaults work without secrets.

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
