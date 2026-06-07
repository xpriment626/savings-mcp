# Mastra Consumer Example

This directory shows one way to consume Savings MCP primitives from a Mastra TS app.

It is not the canonical Savings MCP contract. The core contract is the raw MCP tool surface in `src/mcp.ts` and the deterministic library modules under `src/`.

The example includes:

- Mastra `createTool` wrappers around core deterministic functions
- structured-output metric specialist agents
- `analyzeSavingsAllocationWorkflow` as one possible composition pattern
- a parallel Mastra `MCPServer` wrapper for the example surface

Run:

```bash
npm run test:examples
```

Boundary:

- no auth
- no wallet provisioning
- no signing or transaction sending
- no custody
- no per-user ledger

Applications that consume Savings MCP should own those responsibilities themselves.
