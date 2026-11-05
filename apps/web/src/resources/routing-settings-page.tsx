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
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMachines, useModelSources } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { EmptyState } from '../components/empty-state.js';
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

export const ROUTING_SETTINGS_HREF = '/app/resources/routing-settings';

const USE_LABELS: Record<RouteUse, string> = {
  coordinator: 'Coordinator',
  session: '会话',
  review: '评审',
  digest: '摘要',
  compaction: '压缩',
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
  rule,
  machines,
  options,
  live,
  onSave,
}: {
  rule: RoutingRuleRecord;
  machines: { id: string; name: string }[];
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
  const [provider, setProvider] = useState<string | null>(rule.provider);
  const [modelId, setModelId] = useState<string | null>(rule.modelId);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    (rule.thinkingLevel as ThinkingLevel | null) ?? 'off',
  );
  const [machineId, setMachineId] = useState(rule.machineId);
  const dirty =
    provider !== rule.provider ||
    modelId !== rule.modelId ||
    (thinkingLevel === 'off' ? null : thinkingLevel) !== rule.thinkingLevel ||
    machineId !== rule.machineId;
  return (
    <div data-testid={`routing-rule-${rule.use}`}>
      <SettingsCard>
        <SettingsRow label={t(USE_LABELS[rule.use])} hint={t('模型与首选机器')}>
          <span className="font-mono text-meta text-content-tertiary">{rule.use}</span>
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
        <SettingsRow label={t('首选机器')}>
          <Select value={machineId} onValueChange={(next) => setMachineId(next)}>
            <SelectTrigger
              aria-label={t('首选机器')}
              className={cn(SETTINGS_SELECT_TRIGGER_CLS, 'w-44')}
            >
              <SelectValue>
                {machineId === null
                  ? t('不固定')
                  : (machines.find((m) => m.id === machineId)?.name ?? machineId)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>{t('不固定')}</SelectItem>
              {machines.map((machine) => (
                <SelectItem key={machine.id} value={machine.id}>
                  {machine.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        {live && onSave !== undefined && (
          <SettingsRow label={t('保存')} hint={dirty ? t('有未保存的改动') : t('已与服务器一致')}>
            <Button
              disabled={!dirty || provider == null || modelId == null}
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
              {t('保存')}
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
  const modelSourcesQ = useModelSources(teamId, live);
  const mutations = useRoutingSettingsMutations(teamId);
  const settings: TeamRoutingSettings = live
    ? (settingsQ.data ?? { enabled: false, rules: [], policies: [] })
    : (fixtureSettings(searchParams) ?? { enabled: false, rules: [], policies: [] });
  const machines = live
    ? (machinesQ.data ?? []).map((machine) => ({ id: machine.id, name: machine.name }))
    : (fixture.resources?.machines ?? [])
        .filter((machine): machine is typeof machine & { id: string } => machine.id != null)
        .map((machine) => ({ id: machine.id, name: machine.name }));
  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);
  const empty = settings.rules.length === 0 && settings.policies.length === 0;
  return (
    <PageShell
      route={ROUTING_SETTINGS_HREF}
      title={t('工作路由')}
      fixture={fixture}
      actions={
        live && empty ? (
          <Button
            data-testid="routing-settings-seed"
            onClick={() =>
              mutations.seed.mutate(undefined, {
                onSuccess: () => toastSuccess(t('已从 Agent 生成规则与策略')),
                onError: (error) => toastError(t('生成失败，请重试。'), error),
              })
            }
          >
            {t('从 Agent 生成')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        <SettingsCard>
          <SettingsRow
            label={t('路由规则开关')}
            hint={
              settings.enabled
                ? t('CAIRN_ROUTING_RULES 已开启；调度走规则与策略。')
                : t('CAIRN_ROUTING_RULES 仍关闭；可先编辑，切流在 PR9。')
            }
          >
            <span data-testid="routing-rules-enabled" className="text-ui text-content-secondary">
              {settings.enabled ? t('规则已启用') : t('规则未启用')}
            </span>
          </SettingsRow>
        </SettingsCard>
        {empty ? (
          <EmptyState
            testId="routing-settings-empty"
            className="mt-2"
            icon={Route}
            title={t('还没有路由规则。')}
            description={t(
              '从现有 Agent 生成 session / review 规则与工作策略，或等 CAIRN_ROUTING_RULES 开启后由服务器种子写入。',
            )}
            action={
              live
                ? {
                    label: t('从 Agent 生成'),
                    onClick: () =>
                      mutations.seed.mutate(undefined, {
                        onSuccess: () => toastSuccess(t('已从 Agent 生成规则与策略')),
                        onError: (error) => toastError(t('生成失败，请重试。'), error),
                      }),
                  }
                : undefined
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <h2 className="m-0 px-1 text-card-title font-medium text-foreground">
                {t('路由规则')}
              </h2>
              {settings.rules.map((rule) => (
                <RuleEditor
                  key={rule.id}
                  rule={rule}
                  machines={machines}
                  options={modelOptions}
                  live={live}
                  onSave={
                    live
                      ? (body) =>
                          mutations.patchRule.mutate(
                            { use: rule.use, body },
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
          </>
        )}
      </div>
    </PageShell>
  );
}
