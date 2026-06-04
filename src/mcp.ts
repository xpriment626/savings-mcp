import { z } from 'zod';

import { compareOpportunities, proposeAllocation } from './allocation.js';
import { getFilteredOpportunities, getUsdcCatalogue } from './catalogue.js';
import {
  allocationOutputSchema,
  compareOpportunitiesOutputSchema,
  savingsCatalogueSchema
} from './core/schemas.js';
import {
  parseCompareOpportunitiesArgs,
  parseFilterOpportunitiesArgs,
  parseProposeAllocationArgs
} from './core/tool-args.js';
import type {
  AppConfig,
  JsonRpcRequest,
  JsonRpcResponse
} from './types.js';

const PURE_INFRA_BOUNDARY =
  'Does not authenticate users, sign, send transactions, custody funds, or maintain ledgers.';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true
} as const;

function jsonSchemaFor(schema: z.ZodType) {
  return z.toJSONSchema(schema);
}

const TOOLS = [
  {
    name: 'get_usdc_opportunities',
    title: 'Get USDC opportunities',
    description:
      `Use when the user asks what canonical Solana USDC savings opportunities are available. Returns typed opportunity data, display summaries, provenance, risk, liquidity, and availability flags. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean' },
        limit: { type: 'number' },
        minTvlUsd: { type: 'number' },
        productTypes: {
          type: 'array',
          items: { enum: ['lending_reserve', 'vault'] }
        }
      }
    },
    outputSchema: jsonSchemaFor(savingsCatalogueSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'compare_opportunities',
    title: 'Compare USDC opportunities',
    description:
      `Use when the user wants to compare selected USDC opportunities by APY, liquidity, risk, availability, and evidence. Returns sorted typed comparison rows with display summaries. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: {
      type: 'object',
      properties: {
        opportunityIds: { type: 'array', items: { type: 'string' } },
        refresh: { type: 'boolean' }
      }
    },
    outputSchema: jsonSchemaFor(compareOpportunitiesOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'propose_allocation',
    title: 'Propose allocation',
    description:
      `Use when the user asks for a deterministic USDC allocation preview across selected opportunities. Returns typed weights, display summaries, rationale, and preview-only warnings. ${PURE_INFRA_BOUNDARY}`,
    inputSchema: {
      type: 'object',
      required: ['opportunityIds', 'amountUsd'],
      properties: {
        opportunityIds: { type: 'array', items: { type: 'string' } },
        amountUsd: { type: 'number' },
        riskPreference: { enum: ['conservative', 'balanced', 'aggressive'] },
        nudges: {
          type: 'array',
          items: { enum: ['more_conservative', 'more_aggressive', 'fewer_pools'] }
        },
        refresh: { type: 'boolean' }
      }
    },
    outputSchema: jsonSchemaFor(allocationOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS
  }
] as const;

const RESOURCES = [
  {
    uri: 'savings://catalogue',
    name: 'Savings catalogue',
    description: 'Full normalized canonical Solana USDC savings catalogue.',
    mimeType: 'application/json'
  },
  {
    uri: 'savings://opportunities/usdc',
    name: 'USDC opportunities',
    description: 'Canonical Solana USDC opportunities across supported venues.',
    mimeType: 'application/json'
  },
  {
    uri: 'savings://risk-model',
    name: 'Risk model',
    description: 'Current deterministic risk dimensions and scoring model.',
    mimeType: 'application/json'
  }
] as const;

function toolResult(payload: unknown, statusText: string) {
  return {
    structuredContent: payload,
    content: [
      {
        type: 'text',
        text: statusText
      }
    ]
  };
}

function riskModelResource() {
  return {
    scope: 'canonical Solana USDC principal only',
    global_base_risk: ['USDC issuer/freeze risk is base asset risk, not per-venue yield risk'],
    dimensions: [
      'venue smart contract risk',
      'liquidity and withdrawal risk',
      'utilization stress',
      'strategy complexity',
      'historical APY stability',
      'TVL/depth',
      'custody/signing/permission surface'
    ],
    tiers: ['conservative', 'moderate', 'elevated', 'high'],
    execution_rule:
      'Agents reason. Deterministic library code allocates and validates previews; auth, signing, transaction construction, transaction sending, and ledgers are external integrator responsibilities.'
  };
}

export async function handleMcpRequest(config: AppConfig, request: JsonRpcRequest | null | undefined): Promise<JsonRpcResponse> {
  const id = request?.id ?? null;
  const method = request?.method;
  const params = request?.params ?? {};
  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: 'savings-mcp',
            version: '0.1.0'
          }
        }
      };
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'resources/list') {
      return { jsonrpc: '2.0', id, result: { resources: RESOURCES } };
    }

    if (method === 'resources/read') {
      const uri = params.uri;
      if (typeof uri !== 'string') throw new Error('resource uri must be a string');

      let payload: unknown;
      if (uri === 'savings://catalogue' || uri === 'savings://opportunities/usdc') {
        payload = await getUsdcCatalogue(config, { refresh: Boolean(params.refresh) });
      } else if (uri === 'savings://risk-model') {
        payload = riskModelResource();
      } else {
        throw new Error(`unknown resource ${uri}`);
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(payload, null, 2)
            }
          ]
        }
      };
    }

    if (method === 'tools/call') {
      const name = params.name;
      const args = params.arguments ?? {};
      let payload: unknown;
      let statusText: string;
      if (name === 'get_usdc_opportunities') {
        payload = await getFilteredOpportunities(config, parseFilterOpportunitiesArgs(args));
        const count = savingsCatalogueSchema.parse(payload).opportunities.length;
        statusText = `${count} USDC savings opportunities loaded.`;
      } else if (name === 'compare_opportunities') {
        payload = await compareOpportunities(config, parseCompareOpportunitiesArgs(args));
        const count = compareOpportunitiesOutputSchema.parse(payload).comparison.length;
        statusText = `${count} USDC opportunities compared.`;
      } else if (name === 'propose_allocation') {
        payload = await proposeAllocation(config, parseProposeAllocationArgs(args));
        statusText = 'Deterministic USDC allocation preview loaded.';
      } else {
        throw new Error(`unknown tool ${String(name)}`);
      }

      return { jsonrpc: '2.0', id, result: toolResult(payload, statusText) };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `method not found: ${String(method)}`
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
