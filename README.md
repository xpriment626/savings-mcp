# Savings MCP

Agent-native USDC savings surface for Solana. The v0 server exposes a raw JSON-RPC MCP endpoint with canonical Solana USDC opportunity discovery, composable current-snapshot analytics, and stateless BYOD historical analytics across supported venues.

The current scope is read-only:

- canonical Solana USDC only: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- supported venues: Kamino, Jupiter Lend, Save/Solend
- allocation weights are deterministic library math
- transaction construction, deposit simulation, execution, signing, and ledgers stay with the integrating app

## Tool Slices

Slice 1 is live venue data normalization:

- `get_usdc_opportunities`
- `get_opportunity`
- `compare_opportunities`
- `get_metric_packet`

These tools return all normalized opportunities they can see. Connector `capabilities`, `integrationStatus`, and `limitations` describe Savings MCP coverage, not whether a public-chain pool is inherently depositable by another app.

Slice 2 is current-snapshot analytics:

- `calculate_rate_metrics`
- `calculate_liquidity_metrics`
- `calculate_capacity_metrics`
- `calculate_strategy_exposure`
- `calculate_opportunity_analytics`
- `screen_opportunities`
- `rank_opportunities`
- `validate_allocation_inputs`
- `calculate_blended_apy`
- `calculate_blended_risk`
- `calculate_concentration`
- `calculate_rebalance_delta`
- `propose_allocation`

Slice 3 is stateless historical analytics. Integrators bring samples or precomputed summaries; Savings MCP does not store service-wide history:

- `get_history_sample_schema`
- `validate_history_samples`
- `summarize_history_quality`
- `calculate_rate_stability`
- `calculate_yield_percentiles`
- `calculate_historical_liquidity_risk`
- `detect_history_anomalies`
- `compare_historical_opportunities`

## Pure Infra Boundary

Savings MCP produces portable payloads that an integrating app, agent runtime, wallet, or backend can decide how to use.

This repo owns:

- venue adapters and normalized USDC opportunity data
- deterministic comparison, scoring, and allocation helpers
- schema-checked payloads for metrics, analysis, and allocation previews
- raw MCP tools that expose those deterministic helpers

Integrating applications own:

- users, auth, sessions, and wallet provisioning
- signatures, transaction submission, and custody decisions
- ledgers, balances, account histories, and UI state
- fee policy and production routing orchestration

## Project Layout

- `src/core/schemas.ts`: canonical zod schemas for opportunities, metric packets, data quality, allocation inputs/outputs, and workflow payloads.
- `src/core/display.ts`: deterministic display summaries for chat agents and lightweight app renderers.
- `src/core/capabilities.ts`: connector capability/status helpers that separate market data from app-side transaction support.
- `src/core/metrics.ts`: deterministic metric packet, data-quality, and allocation-readiness helpers.
- `src/core/analysis.ts`: deterministic specialist analysis and narration helpers.
- `src/core/tool-args.ts`: shared zod-backed argument parsing for raw MCP tools.
- `src/current-analytics.ts`: deterministic current-snapshot opportunity, metric, screen, rank, allocation, concentration, and rebalance helpers.
- `src/history-analytics.ts`: stateless BYOD historical validation, stability, percentile, liquidity-risk, anomaly, and comparison helpers.
- `src/venues/types.ts`: venue adapter contract for normalized USDC savings venues.
- `src/venues/kamino.ts`: Kamino adapter implementation for fixture/live USDC catalogue data.
- `src/venues/jupiter-lend.ts`: Jupiter Lend adapter implementation for fixture/live USDC Earn data.
- `src/venues/save-solend.ts`: Save/Solend adapter implementation for fixture/live USDC reserve data.
- `src/mcp.ts`: raw JSON-RPC MCP method/tool/resource handling.
- `src/server.ts`: local HTTP server entrypoint.
- `examples/mastra-consumer`: optional Mastra consumer example that wraps the same deterministic tools.

## Run

```bash
npm run dev
```

Endpoint:

```text
http://127.0.0.1:8788/mcp
```

## Contributor Tests

Run deterministic core checks without leaving a server running:

```bash
npm run typecheck
npm test
npm run test:raw
```

Run examples separately:

```bash
npm run test:examples
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
- More granular clients can call `get_metric_packet`, metric calculators, screen/rank tools, allocation math tools, and BYOD history tools directly.
- The agent reasons from `structuredContent`, not by parsing JSON text from `content`.
- Opportunity responses include stable IDs, source/provenance, APY, TVL, liquidity, risk, connector `capabilities`, `integrationStatus`, `limitations`, evidence, and `display` summaries.
- Fixture responses include Kamino, Jupiter Lend, and Save/Solend USDC opportunities.
- Live responses include per-venue `venueReports`; a temporarily unavailable venue is surfaced as a report/warning instead of crashing the whole catalogue.
- Allocation responses are explicitly preview-only and keep auth/signing/transaction/ledger responsibilities outside Savings MCP.
- Any limitations around connector transaction-blueprint coverage, simulation support, managed vault exposure, or high utilization stay visible to the model without hiding market data.

Known live-data limitations:

- Jupiter Lend USDC Earn is normalized as a `vault`-style opportunity because it exposes jlUSDC receipt-token and debt-ceiling withdrawal mechanics, not a reserve-style utilization model. Utilization is `null`; withdrawal buffer reflects currently withdrawable assets when available.
- Save/Solend uses public market config and reserve detail endpoints for catalogue data. User obligation state is intentionally not read, so the adapter does not infer whether a user deposit is serving as collateral for liabilities.
- `integrationStatus` describes what this MCP connector has normalized (`market_data_only`, `tx_blueprint_known`, or `simulation_supported`). It is not a universal statement that a public-chain pool can or cannot be deposited into by another app or wallet.

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
