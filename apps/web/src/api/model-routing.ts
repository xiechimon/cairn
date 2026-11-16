import type {
  ProviderRecord,
  RouteUse,
  RoutingConnection,
  RoutingEdge,
  RoutingQuota,
  TeamRoutingSettings,
  TopModel,
} from '@cairn/shared';
import { useQuery } from '@tanstack/react-query';
import type { RoutingSourceGroup } from '../components/settings/routing-graph.js';
import type { ModelOption } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';
import type { SubscriptionAccount } from './claude-accounts.js';
import { api } from './client.js';

export interface ModelRouting {
  edges: RoutingEdge[];
  connections: RoutingConnection[];
  quota: RoutingQuota[];
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

export const ROUTE_USE_LABELS: Record<RouteUse, string> = {
  coordinator: 'Coordinator',
  session: '新任务',
  review: '评审',
  digest: '摘要',
  compaction: '压缩',
};

const GRAPH_USES: readonly RouteUse[] = [
  'coordinator',
  'session',
  'review',
  'digest',
  'compaction',
];

const CLAUDE_CODE_TARGET = 'claude-code';

export interface RoutingTargetRow {
  id: string;
  name: string;
  runtime: 'claude-code' | 'pi';
  plan: string | null;
  quota?: { fiveHour: number | null; week: number | null };
  unavailable: boolean;
  record?: ProviderRecord;
}

function leftOf(usedPercent: number | null | undefined): number | null {
  if (usedPercent == null || !Number.isFinite(usedPercent)) return null;
  return Math.max(0, Math.round(100 - usedPercent));
}

function accountLeft(account: SubscriptionAccount, name: string): number | null {
  const window = account.windows.find((w) => w.name === name);
  return window === undefined ? null : leftOf(window.utilization * 100);
}

function quotaOf(fiveHour: number | null, week: number | null) {
  return fiveHour !== null || week !== null ? { quota: { fiveHour, week } } : {};
}

export function routingTargets({
  subscriptions,
  providers,
  routing,
}: {
  subscriptions: readonly SubscriptionAccount[];
  providers: readonly ProviderRecord[];
  routing: ModelRouting | undefined;
}): RoutingTargetRow[] {
  const rows: RoutingTargetRow[] = subscriptions.map((account) => ({
    id: `subscription:${account.id}`,
    name: account.label,
    runtime: 'claude-code',
    plan: account.plan,
    ...quotaOf(accountLeft(account, 'five_hour'), accountLeft(account, 'seven_day')),
    unavailable: account.state === 'expired',
  }));
  for (const record of providers) {
    const connections = (routing?.connections ?? []).filter((c) => c.id === record.id);
    rows.push({
      id: `provider:${record.id}`,
      name: record.label,
      runtime: 'pi',
      plan: null,
      unavailable: connections.length > 0 && connections.every((c) => c.available === false),
      record,
    });
  }
  return rows;
}

function targetOfRule(provider: string, targets: readonly RoutingTargetRow[]) {
  if (provider === CLAUDE_CODE_TARGET) {
    const claude = targets.filter((target) => target.runtime === 'claude-code');
    return claude.find((target) => !target.unavailable) ?? claude[0];
  }
  return targets.find((target) => target.record?.providerId === provider);
}

function modelName(provider: string, modelId: string, options: readonly ModelOption[]) {
  return (
    options.find((o) => o.provider === provider && o.modelId === modelId)?.modelName ??
    options.find((o) => o.modelId === modelId)?.modelName ??
    modelId
  );
}

export function ruleGraphGroups(
  settings: TeamRoutingSettings,
  targets: readonly RoutingTargetRow[],
  options: readonly ModelOption[],
  t: TFunc,
  topModels: readonly TopModel[] = [],
): RoutingSourceGroup[] {
  const top = topModels.map((model) => {
    const target = targetOfRule(model.provider, targets);
    return {
      id: `top:${model.provider}/${model.modelId}`,
      name: modelName(model.provider, model.modelId, options),
      ...(target !== undefined ? { target: target.id } : {}),
      broken: target === undefined || target.unavailable,
    };
  });
  const agents: RoutingSourceGroup['nodes'] = [];
  for (const use of GRAPH_USES) {
    const rule = settings.rules.find((r) => r.use === use);
    const fallback = rule === undefined && use === 'session' ? settings.sessionDefault : undefined;
    const provider = rule?.provider ?? fallback?.provider ?? null;
    const modelId = rule?.modelId ?? fallback?.modelId ?? null;
    if (provider === null || modelId === null) continue;
    const target = targetOfRule(provider, targets);
    const name = modelName(provider, modelId, options);
    agents.push({
      id: use,
      name: t(ROUTE_USE_LABELS[use]),
      tag: rule === undefined ? t('{model} · 默认', { model: name }) : name,
      ...(target !== undefined ? { target: target.id } : {}),
      broken: target === undefined || target.unavailable,
    });
  }
  const groups: RoutingSourceGroup[] = [];
  if (top.length > 0) groups.push({ label: t('常用模型'), nodes: top });
  if (agents.length > 0) groups.push({ label: t('Coordinator 和其他 Agent'), nodes: agents });
  const claude = targetOfRule(CLAUDE_CODE_TARGET, targets);
  if (claude !== undefined) {
    groups.push({
      label: 'Claude Code',
      nodes: [{ id: 'claude-models', name: t('所有 Claude 模型'), target: claude.id }],
    });
  }
  return groups;
}
