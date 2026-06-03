import { compareOpportunities, proposeAllocation } from './allocation.js';
import { getFilteredOpportunities, getUsdcCatalogue } from './catalogue.js';
import type {
  AppConfig,
  AllocationNudge,
  CompareOpportunitiesArgs,
  FilterOpportunitiesArgs,
  JsonRpcRequest,
  JsonRpcResponse,
  ProductType,
  ProposeAllocationArgs,
  RiskPreference
} from './types.js';

const TOOLS = [
  {
    name: 'get_usdc_opportunities',
    description: 'Return normalized canonical Solana USDC savings opportunities, starting with Kamino.',
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
    }
  },
  {
    name: 'compare_opportunities',
    description: 'Compare USDC opportunities while preserving APY, liquidity, venue risk, and evidence fields.',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityIds: { type: 'array', items: { type: 'string' } },
        refresh: { type: 'boolean' }
      }
    }
  },
  {
    name: 'propose_allocation',
    description: 'Create a deterministic preview allocation across selected USDC opportunities.',
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
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function productTypes(value: unknown): ProductType[] | undefined {
  const valid = new Set<ProductType>(['lending_reserve', 'vault']);
  const items = stringArray(value)?.filter((item): item is ProductType => valid.has(item as ProductType));
  return items && items.length > 0 ? items : undefined;
}

function allocationNudges(value: unknown): AllocationNudge[] | undefined {
  const valid = new Set<AllocationNudge>(['more_conservative', 'more_aggressive', 'fewer_pools']);
  const items = stringArray(value)?.filter((item): item is AllocationNudge => valid.has(item as AllocationNudge));
  return items && items.length > 0 ? items : undefined;
}

function riskPreference(value: unknown): RiskPreference | undefined {
  if (value === 'conservative' || value === 'balanced' || value === 'aggressive') return value;
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function filterArgs(value: unknown): FilterOpportunitiesArgs {
  if (!isRecord(value)) return {};
  const args: FilterOpportunitiesArgs = { refresh: Boolean(value.refresh) };
  const limit = numberValue(value.limit);
  const minTvlUsd = numberValue(value.minTvlUsd);
  const types = productTypes(value.productTypes);
  if (limit !== undefined) args.limit = limit;
  if (minTvlUsd !== undefined) args.minTvlUsd = minTvlUsd;
  if (types !== undefined) args.productTypes = types;
  return args;
}

function compareArgs(value: unknown): CompareOpportunitiesArgs {
  if (!isRecord(value)) return {};
  const args: CompareOpportunitiesArgs = { refresh: Boolean(value.refresh) };
  const opportunityIds = stringArray(value.opportunityIds);
  if (opportunityIds !== undefined) args.opportunityIds = opportunityIds;
  return args;
}

function proposeArgs(value: unknown): ProposeAllocationArgs {
  if (!isRecord(value)) return {};
  const args: ProposeAllocationArgs = { refresh: Boolean(value.refresh) };
  const opportunityIds = stringArray(value.opportunityIds);
  const amountUsd = numberValue(value.amountUsd);
  const preference = riskPreference(value.riskPreference);
  const nudges = allocationNudges(value.nudges);
  if (opportunityIds !== undefined) args.opportunityIds = opportunityIds;
  if (amountUsd !== undefined) args.amountUsd = amountUsd;
  if (preference !== undefined) args.riskPreference = preference;
  if (nudges !== undefined) args.nudges = nudges;
  return args;
}

function jsonText(payload: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
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
    execution_rule: 'Agents reason. Library code allocates, validates, simulates, and prepares transactions.'
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
      if (name === 'get_usdc_opportunities') payload = await getFilteredOpportunities(config, filterArgs(args));
      else if (name === 'compare_opportunities') payload = await compareOpportunities(config, compareArgs(args));
      else if (name === 'propose_allocation') payload = await proposeAllocation(config, proposeArgs(args));
      else throw new Error(`unknown tool ${String(name)}`);

      return { jsonrpc: '2.0', id, result: jsonText(payload) };
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
