import type { OpportunityCapabilities } from './schemas.js';

export type IntegrationStatus = 'market_data_only' | 'tx_blueprint_known' | 'simulation_supported' | 'execution_supported';

export function integrationStatusFor(capabilities: OpportunityCapabilities): IntegrationStatus {
  if (capabilities.executionSupported) return 'execution_supported';
  if (capabilities.simulationSupported) return 'simulation_supported';
  if (capabilities.depositTxKnown) return 'tx_blueprint_known';
  return 'market_data_only';
}

export function connectorCapabilities(input: {
  depositTxKnown: boolean;
  simulationSupported?: boolean;
  executionSupported?: boolean;
}): OpportunityCapabilities {
  return {
    marketData: true,
    riskData: true,
    depositTxKnown: input.depositTxKnown,
    simulationSupported: Boolean(input.simulationSupported),
    executionSupported: Boolean(input.executionSupported)
  };
}

export function integrationLimitations(capabilities: OpportunityCapabilities, extra: readonly string[] = []): string[] {
  const limitations: string[] = [];
  if (!capabilities.depositTxKnown) {
    limitations.push('connector provides market and risk data only; deposit transaction path is app-side or protocol-SDK work');
  }
  if (!capabilities.simulationSupported) limitations.push('simulation is an app-side responsibility for this opportunity');
  if (!capabilities.executionSupported) {
    limitations.push('transaction signing, sending, custody, and user accounting are app-side responsibilities');
  }
  return [...limitations, ...extra];
}
