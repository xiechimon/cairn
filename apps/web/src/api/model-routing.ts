import type {
  ClaudeUsage,
  ProviderRecord,
  RoutingConnection,
  RoutingEdge,
  RoutingQuota,
  RoutingUse,
} from '@cairn/shared';
import { useQuery } from '@tanstack/react-query';
import type {
  RoutingConnection as GraphConnection,
  RoutingJob,
} from '../components/settings/routing-graph.js';
import type { TFunc } from '../i18n/translate.js';
import type { AccountVendor, SubscriptionAccount } from './claude-accounts.js';
import { api } from './client.js';

export interface ModelRouting {
  edges: RoutingEdge[];
  connections: RoutingConnection[];
  quota: RoutingQuota[];
  settings: { claudeUsage: ClaudeUsage };
}

export const MODEL_ROUTING_KEY = 'model-routing';

export const QUOTA_REFRESH_MS = 60_000;

export function useModelRouting(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: [MODEL_ROUTING_KEY, teamId],
    queryFn: () => api.get<ModelRouting>(`/api/teams/${teamId}/model-routing`),
    enabled: live && teamId !== undefined,
    refetchInterval: QUOTA_REFRESH_MS,
  });
}

const USE_LABELS: Record<RoutingUse, string> = {
  coordinator: 'Coordinator',
  implementation: '实现',
  review: '评审',
  mechanical: '机械活',
  eval: '评测',
  'nightly-scan': '每晚扫描',
};

const TONES = [1, 2, 3, 4, 5, 6] as const;

const VENDOR_NAMES: Record<AccountVendor, string> = {
  claude: 'Claude',
  codex: 'ChatGPT',
  grok: 'Grok',
};

const MACHINE_PREFIX = 'machine:';

function leftOf(usedPercent: number | null | undefined): number | null {
  if (usedPercent == null || !Number.isFinite(usedPercent)) return null;
  return Math.max(0, Math.round(100 - usedPercent));
}

function accountLeft(account: SubscriptionAccount, name: string): number | null {
  const window = account.windows.find((w) => w.name === name);
  return window === undefined ? null : leftOf(window.utilization * 100);
}

export interface RoutingGraphContext {
  accounts: readonly SubscriptionAccount[];
  providers: readonly Pick<ProviderRecord, 'id' | 'label'>[];
  machineNames: ReadonlyMap<string, string>;
  t: TFunc;
}

export function toRoutingGraph(
  routing: ModelRouting,
  { accounts, providers, machineNames, t }: RoutingGraphContext,
): { jobs: RoutingJob[]; connections: GraphConnection[] } {
  const seen = new Set<string>();
  const connections: GraphConnection[] = [];
  for (const connection of routing.connections) {
    if (seen.has(connection.id)) continue;
    seen.add(connection.id);
    const unavailable = connection.available === false;
    const account = accounts.find((a) => a.id === connection.id);
    if (account !== undefined) {
      const fiveHour = accountLeft(account, 'five_hour');
      const week = accountLeft(account, 'seven_day');
      connections.push({
        id: connection.id,
        name: `${VENDOR_NAMES[account.vendor]} · ${account.label}`,
        ...(account.plan !== null ? { tier: account.plan } : {}),
        ...(fiveHour !== null || week !== null ? { quota: { fiveHour, week } } : {}),
        unavailable,
      });
      continue;
    }
    if (connection.id.startsWith(MACHINE_PREFIX)) {
      const machineId = connection.id.slice(MACHINE_PREFIX.length);
      const windows = routing.quota.find((q) => q.connectionId === connection.id)?.windows ?? [];
      const fiveHour = leftOf(windows.find((w) => w.window === '5h')?.usedPercent);
      const week = leftOf(windows.find((w) => w.window === 'week')?.usedPercent);
      connections.push({
        id: connection.id,
        name: `Claude Code · ${machineNames.get(machineId) ?? machineId}`,
        tier: connection.kind === 'subscription' ? t('订阅') : t('API key'),
        ...(fiveHour !== null || week !== null ? { quota: { fiveHour, week } } : {}),
        unavailable,
      });
      continue;
    }
    connections.push({
      id: connection.id,
      name: providers.find((p) => p.id === connection.id)?.label ?? connection.id,
      tier: connection.kind === 'subscription' ? t('订阅') : t('API key'),
      unavailable,
    });
  }
  const jobs = routing.edges.map(
    (edge, index): RoutingJob => ({
      id: edge.use,
      name: t(USE_LABELS[edge.use]),
      model: edge.modelId,
      tone: TONES[index % TONES.length] ?? 1,
      ...(edge.connectionId !== null ? { connectionId: edge.connectionId } : {}),
      unavailable: edge.unavailable === true || edge.connectionId === null,
    }),
  );
  return { jobs, connections };
}
