# Savings MCP

Agent-native USDC savings surface for Solana. The v0 server exposes a raw JSON-RPC MCP endpoint with Kamino-backed canonical USDC opportunity discovery, comparison, and deterministic allocation previews.

The current scope is read-only:

- canonical Solana USDC only: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Kamino is the first venue
- allocation weights are deterministic library math
- execution, signing, and deposit simulation are not wired yet

## Run

```bash
npm run dev
```

Endpoint:

```text
http://127.0.0.1:8788/mcp
```

## Raw Request Scripts

Run deterministic raw endpoint smoke tests without leaving a server running:

```bash
npm run test:raw
```

Call a running local server:

```bash
npm run request:catalogue
tsx scripts/raw-request.ts propose_allocation '{"opportunityIds":["kamino:lend:main-usdc","kamino:earn:usdc-core"],"amountUsd":10000,"riskPreference":"balanced"}'
```

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
