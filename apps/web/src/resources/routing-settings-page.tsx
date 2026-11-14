import {
  AGENT_TOOL_SWITCHES,
  type PolicyUse,
  type RouteUse,
  type RoutingRuleRecord,
  type TeamRoutingSettings,
  THINKING_LEVELS,
  type ThinkingLevel,
  type WorkPolicyRecord,
} from '@cairn/shared';
import { cn } from 'cn';
import { Route } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useMachines, useModelSources, useTeams } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { EmptyState } from '../components/empty-state.js';
import { MachineName, machineLabel } from '../components/machine-label.js';
import { QueryBoundary } from '../components/query-state.js';
import {
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
} from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import type { ModelOption } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { AgentModelSelect, AgentRuntimeSelect } from '../routes/agent-model-select.js';
import { settingsHref } from '../settings/settings-href.js';

export const ROUTING_SETTINGS_HREF = '/app/resources/routing-settings';
export const COORDINATOR_ROUTE_ANCHOR = 'route-coordinator';
export const COORDINATOR_ROUTING_HREF = `${settingsHref('work-routing')}#${COORDINATOR_ROUTE_ANCHOR}`;

const CREATABLE_USES: readonly RouteUse[] = ['coordinator', 'review', 'citation_check'];

const USE_LABELS: Record<RouteUse, string> = {
  coordinator: 'Coordinator',
  session: '会话',
  review: '评审',
  digest: '摘要',
  compaction: '压缩',
  citation_check: '引文检查',
};

const POLICY_LABELS: Record<PolicyUse, string> = {
  session: '会话权限',
  review: '评审权限',
};

function fixtureSettings(search: URLSearchParams): TeamRoutingSettings | null {
  const raw = resolveScenario(search).resources?.routingSettings;
  return raw ?? null;
}

function RuleEditor({
  use,
  rule,
  machines,
  hasDefault,
  options,
  live,
  onSave,
}: {
  use: RouteUse;
  rule: RoutingRuleRecord | null;
  machines: { id: string; name: string }[];
  hasDefault: boolean;
  options: ModelOption[];
  live: boolean;
  onSave?: (body: {
    provider: string;
    modelId: string;
    thinkingLevel: ThinkingLevel | null;
    machineId: string | null;
  }) => void;
}) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<string | null>(rule?.provider ?? null);
  const [modelId, setModelId] = useState<string | null>(rule?.modelId ?? null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    (rule?.thinkingLevel as ThinkingLevel | null | undefined) ?? 'off',
  );
  const [machineId, setMachineId] = useState(rule?.machineId ?? null);
  const mustNameMachine = use === 'session' && machines.length > 1 && !hasDefault;
  const unsetLabel = hasDefault ? t('跟随默认 Runner') : t('不固定');
  const pickedMachine = machines.find((m) => m.id === machineId);
  const dirty =
    rule === null ||
    provider !== rule.provider ||
    modelId !== rule.modelId ||
    (thinkingLevel === 'off' ? null : thinkingLevel) !== rule.thinkingLevel ||
    machineId !== rule.machineId;
  return (
    <div
      id={`route-${use}`}
      data-testid={rule === null ? `routing-rule-new-${use}` : `routing-rule-${use}`}
    >
      <SettingsCard>
        <SettingsRow label={t(USE_LABELS[use])} hint={t('模型与首选 Runner')}>
          <span className="font-mono text-meta text-content-tertiary">{use}</span>
        </SettingsRow>
        <SettingsRow label={t('运行时')}>
          <AgentRuntimeSelect
            ariaLabel={t('运行时')}
            value={provider}
            options={options}
            unsetLabel={t('选择运行时')}
            onPick={(next) => {
              if (next === provider) return;
              setProvider(next);
              setModelId(null);
            }}
            prefix="routing-rule-runtime"
            triggerClassName={cn(SETTINGS_SELECT_TRIGGER_CLS, 'w-44')}
          />
        </SettingsRow>
        <SettingsRow label={t('模型')}>
          <AgentModelSelect
            ariaLabel={t('模型')}
            provider={provider}
            modelId={modelId}
            options={options}
            onPick={(next) => setModelId(next)}
            prefix="routing-rule-model"
            triggerClassName={cn(SETTINGS_SELECT_TRIGGER_CLS, 'w-56')}
          />
        </SettingsRow>
        <SettingsRow label={t('思考强度')}>
          <Select value={thinkingLevel} onValueChange={(next) => setThinkingLevel(next ?? 'off')}>
            <SelectTrigger
              aria-label={t('思考强度')}
              className={cn(SETTINGS_SELECT_TRIGGER_CLS, 'w-36')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THINKING_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label={t('首选 Runner')}>
          <Select value={machineId} onValueChange={(next) => setMachineId(next)}>
            <SelectTrigger
              aria-label={t('首选 Runner')}
              className={cn(SETTINGS_SELECT_TRIGGER_CLS, 'w-44')}
            >
              <SelectValue>
                {machineId === null
                  ? mustNameMachine
                    ? t('选择 Runner')
                    : unsetLabel
                  : pickedMachine === undefined
                    ? undefined
                    : (machineLabel(pickedMachine, machines) ?? machineId)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {mustNameMachine ? null : <SelectItem value={null}>{unsetLabel}</SelectItem>}
              {machines.map((machine) => (
                <SelectItem key={machine.id} value={machine.id}>
                  <MachineName machine={machine} all={machines} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        {live && onSave !== undefined && (
          <SettingsRow
            label={rule === null ? t('创建') : t('保存')}
            hint={
              rule === null
                ? t('这条路由还没有规则，选好运行时与模型后创建。')
                : dirty
                  ? t('有未保存的改动')
                  : t('已与服务器一致')
            }
          >
            <Button
              disabled={
                !dirty ||
                provider == null ||
                modelId == null ||
                (mustNameMachine && machineId == null)
              }
              onClick={() => {
                if (provider == null || modelId == null) return;
                onSave({
                  provider,
                  modelId,
                  thinkingLevel: thinkingLevel === 'off' ? null : thinkingLevel,
                  machineId,
                });
              }}
            >
              {rule === null ? t('创建') : t('保存')}
            </Button>
          </SettingsRow>
        )}
      </SettingsCard>
    </div>
  );
}

function PolicyEditor({
  policy,
  live,
  onSave,
}: {
  policy: WorkPolicyRecord;
  live: boolean;
  onSave?: (body: { tools: string[] }) => void;
}) {
  const { t } = useI18n();
  const [tools, setTools] = useState(() => new Set(policy.tools));
  const dirty = tools.size !== policy.tools.length || policy.tools.some((tool) => !tools.has(tool));
  const toggle = (tool: string) => {
    setTools((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });
  };
  return (
    <div data-testid={`work-policy-${policy.use}`}>
      <SettingsCard>
        <SettingsRow
          label={t(POLICY_LABELS[policy.use])}
          hint={t('声明可写工具；密钥与 MCP 只读展示')}
        >
          <span className="font-mono text-meta text-content-tertiary">{policy.use}</span>
        </SettingsRow>
        {AGENT_TOOL_SWITCHES.map((tool) => (
          <SettingsRow key={tool} label={t(tool)}>
            <ToggleSwitch
              checked={tools.has(tool)}
              disabled={!live || onSave === undefined}
              onCheckedChange={() => toggle(tool)}
              aria-label={t(tool)}
            />
          </SettingsRow>
        ))}
        <SettingsRow
          label={t('MCP 服务器')}
          hint={policy.mcpServers.length === 0 ? t('未配置') : policy.mcpServers.join(', ')}
        >
          <span className="text-meta text-content-secondary">{policy.mcpServers.length}</span>
        </SettingsRow>
        <SettingsRow
          label={t('密钥')}
          hint={policy.secrets.length === 0 ? t('未配置') : policy.secrets.join(', ')}
        >
          <span className="text-meta text-content-secondary">{policy.secrets.length}</span>
        </SettingsRow>
        {live && onSave !== undefined && (
          <SettingsRow label={t('保存')} hint={dirty ? t('有未保存的改动') : t('已与服务器一致')}>
            <Button disabled={!dirty} onClick={() => onSave({ tools: [...tools] })}>
              {t('保存')}
            </Button>
          </SettingsRow>
        )}
      </SettingsCard>
    </div>
  );
}

export function RoutingSettingsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const settingsQ = useRoutingSettings(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const teamsQ = useTeams(live);
  const modelSourcesQ = useModelSources(teamId, live);
  const mutations = useRoutingSettingsMutations(teamId);
  const settings: TeamRoutingSettings = live
    ? (settingsQ.data ?? { rules: [], policies: [] })
    : (fixtureSettings(searchParams) ?? { rules: [], policies: [] });
  const machines = live
    ? (machinesQ.data ?? []).map((machine) => ({ id: machine.id, name: machine.name }))
    : (fixture.resources?.machines ?? [])
        .filter((machine): machine is typeof machine & { id: string } => machine.id != null)
        .map((machine) => ({ id: machine.id, name: machine.name }));
  const defaultMachineId = live ? (teamsQ.data?.[0]?.defaultMachineId ?? null) : null;
  const hasDefault = machines.some((machine) => machine.id === defaultMachineId);
  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);
  const empty = settings.rules.length === 0 && settings.policies.length === 0;
  const { hash } = useLocation();
  const loaded = !live || settingsQ.data !== undefined;
  const missingUses = loaded
    ? CREATABLE_USES.filter((use) => !settings.rules.some((rule) => rule.use === use))
    : [];
  useEffect(() => {
    if (!loaded || hash === '') return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);
  const saveRule = (
    use: RouteUse,
    body: Parameters<typeof mutations.patchRule.mutate>[0]['body'],
  ) =>
    mutations.patchRule.mutate(
      { use, body },
      {
        onSuccess: () => toastSuccess(t('规则已保存')),
        onError: (error) => toastError(t('保存失败，请重试。'), error),
      },
    );
  return (
    <PageShell route={ROUTING_SETTINGS_HREF} title={t('规则与策略')} fixture={fixture}>
      <QueryBoundary
        query={live ? settingsQ : undefined}
        isEmpty={live && settingsQ.data === undefined}
        loadingLabel={t('正在加载规则与策略')}
        errorTitle={t('规则与策略没能加载')}
        className="mt-6"
        empty={null}
      >
        <div className="flex flex-col gap-6">
          {empty && (
            <EmptyState
              testId="routing-settings-empty"
              className="mt-2"
              icon={Route}
              title={t('还没有路由规则')}
              description={t('先创建 Coordinator 规则，它才能回答你的消息。')}
            />
          )}
          {(settings.rules.length > 0 || missingUses.length > 0) && (
            <div className="flex flex-col gap-4">
              <h2 className="m-0 px-1 text-card-title font-medium text-foreground">
                {t('路由规则')}
              </h2>
              {settings.rules.map((rule) => (
                <RuleEditor
                  key={rule.id}
                  use={rule.use}
                  rule={rule}
                  machines={machines}
                  hasDefault={hasDefault}
                  options={modelOptions}
                  live={live}
                  onSave={live ? (body) => saveRule(rule.use, body) : undefined}
                />
              ))}
              {missingUses.map((use) => (
                <RuleEditor
                  key={`new-${use}`}
                  use={use}
                  rule={null}
                  machines={machines}
                  hasDefault={hasDefault}
                  options={modelOptions}
                  live={live}
                  onSave={live ? (body) => saveRule(use, body) : undefined}
                />
              ))}
            </div>
          )}
          {settings.policies.length > 0 && (
            <div className="flex flex-col gap-4">
              <h2 className="m-0 px-1 text-card-title font-medium text-foreground">
                {t('工作策略')}
              </h2>
              {settings.policies.map((policy) => (
                <PolicyEditor
                  key={policy.id}
                  policy={policy}
                  live={live}
                  onSave={
                    live
                      ? (body) =>
                          mutations.patchPolicy.mutate(
                            { use: policy.use, body },
                            {
                              onSuccess: () => toastSuccess(t('规则已保存')),
                              onError: (error) => toastError(t('保存失败，请重试。'), error),
                            },
                          )
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </QueryBoundary>
    </PageShell>
  );
}
