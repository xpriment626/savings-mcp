import { MCPServer } from '@mastra/mcp';

import type { AppConfig } from '../../../src/types.js';
import { createSavingsMastraTools } from './tools/index.js';
import { createAnalyzeSavingsAllocationWorkflow } from './workflows/analyze-savings-allocation.js';

export function createSavingsMastraMcpSurface(overrides: Partial<AppConfig> = {}) {
  const tools = createSavingsMastraTools(overrides);
  const analyzeSavingsAllocationWorkflow = createAnalyzeSavingsAllocationWorkflow(overrides);
  const workflows = { analyzeSavingsAllocationWorkflow };

  return { tools, workflows };
}

export function createSavingsMastraMcpServer(overrides: Partial<AppConfig> = {}): MCPServer {
  const { tools, workflows } = createSavingsMastraMcpSurface(overrides);

  return new MCPServer({
    id: 'savings-mastra-mcp',
    name: 'Savings Mastra MCP',
    version: '0.1.0',
    description: 'Parallel Mastra MCP surface for canonical Solana USDC savings analysis.',
    instructions:
      'Use these tools and workflows to produce portable savings-analysis payloads. Do not ask this server to authenticate users, sign, send, or persist account ledgers.',
    tools,
    workflows
  });
}
