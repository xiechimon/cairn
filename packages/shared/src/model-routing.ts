import type { ThinkingLevel } from './agent-backend.js';

export const ROUTING_USES = [
  'coordinator',
  'implementation',
  'review',
  'mechanical',
  'eval',
  'nightly-scan',
] as const;
export type RoutingUse = (typeof ROUTING_USES)[number];
export type RoutingVendor = 'anthropic' | 'openai';

export interface RoutingConnection {
  id: string;
  vendor: RoutingVendor;
  kind: 'subscription' | 'api-key';
  models: readonly string[];
  available?: boolean;
}

export interface RoutingQuota {
  connectionId: string;
  windows: readonly {
    window: '5h' | 'week';
    usedPercent: number | null;
    resetsAt?: number | null;
    reportedAt?: number;
  }[];
}

export interface RoutingUseRequest {
  use: RoutingUse;
  trigger?: 'manual' | 'schedule';
  implementationVendor?: RoutingVendor;
  inFlight?: { modelId: string; effort: ThinkingLevel; connectionId: string };
}

export interface RoutingEdge {
  use: RoutingUse;
  modelId: string;
  effort: ThinkingLevel;
  connectionId: string | null;
  reason?: 'codex-quota<=30%' | 'subscription-only' | 'no-connection';
  unavailable?: boolean;
}

const CLAUDE_MODELS = {
  coordinator: 'claude-opus-5-5',
  implementation: 'claude-sonnet-5-5',
  review: 'claude-sonnet-5-5',
  mechanical: 'claude-haiku-5-5',
  eval: 'claude-sonnet-5-5',
  'nightly-scan': 'claude-haiku-5-5',
} as const;

export function resolveRouting(
  uses: readonly RoutingUseRequest[],
  connections: readonly RoutingConnection[],
  quota: readonly RoutingQuota[],
): { edges: RoutingEdge[] } {
  const codex = connections.find(
    (connection) =>
      connection.vendor === 'openai' &&
      connection.available !== false &&
      connection.models.includes('gpt-6.1-sol'),
  );
  const lowCodex = quota.some(
    (entry) =>
      entry.connectionId === codex?.id &&
      entry.windows.some(
        (window) =>
          window.window === 'week' &&
          window.usedPercent !== null &&
          Number.isFinite(window.usedPercent) &&
          window.usedPercent >= 70 &&
          window.usedPercent <= 100,
      ),
  );
  const implementation = uses.find((request) => request.use === 'implementation');
  const pinnedVendor = implementation?.inFlight
    ? (connections.find((connection) => connection.id === implementation.inFlight?.connectionId)
        ?.vendor ?? (implementation.inFlight.modelId.startsWith('claude') ? 'anthropic' : 'openai'))
    : undefined;
  const implementationVendor =
    pinnedVendor ?? (lowCodex || codex === undefined ? 'anthropic' : 'openai');
  const edges = uses.map((request): RoutingEdge => {
    if (request.inFlight) {
      const connection = connections.find((entry) => entry.id === request.inFlight?.connectionId);
      return {
        use: request.use,
        ...request.inFlight,
        ...(connection?.available === false ||
        connection === undefined ||
        !connection.models.includes(request.inFlight.modelId)
          ? { unavailable: true, reason: 'no-connection' }
          : {}),
      };
    }
    const vendor: RoutingVendor =
      request.use === 'implementation'
        ? implementationVendor
        : request.use === 'review'
          ? (request.implementationVendor ?? implementationVendor) === 'openai'
            ? 'anthropic'
            : 'openai'
          : 'anthropic';
    const modelId = vendor === 'openai' ? 'gpt-6.1-sol' : CLAUDE_MODELS[request.use];
    const candidates = connections.filter(
      (connection) =>
        connection.vendor === vendor &&
        connection.models.includes(modelId) &&
        connection.available !== false,
    );
    const connection = candidates.find((entry) => entry.kind === 'subscription') ?? candidates[0];
    return {
      use: request.use,
      modelId,
      effort: request.use === 'mechanical' || request.use === 'nightly-scan' ? 'low' : 'high',
      connectionId: connection?.id ?? null,
      ...(connection === undefined
        ? { unavailable: true, reason: 'no-connection' }
        : request.use === 'implementation' && lowCodex
          ? { reason: 'codex-quota<=30%' }
          : {}),
    };
  });
  return { edges };
}
