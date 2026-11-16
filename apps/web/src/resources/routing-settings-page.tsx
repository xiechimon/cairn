import {
  type CoordinatorDefault,
  MODEL_SOURCE_RUNTIME_LABELS,
  type ModelSourceRuntime,
  type RouteUse,
  type RoutingRuleRecord,
  type RuleFix,
  type SessionDefault,
  type TeamRoutingSettings,
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@cairn/shared';
import { type ReactNode, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useMachines, useModelSources } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { ROUTE_USE_LABELS } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { useTopModels, useTopModelsMutations } from '../api/top-models.js';
import { QueryBoundary } from '../components/query-state.js';
import { SettingsCard, SettingsRow, SettingsSection } from '../components/settings-list.js';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import type { ModelOption } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { settingsHref } from '../settings/settings-href.js';
import { RuleIssueNotices } from './rule-issue-notices.js';
import { suggestedTopModels, TopModelsCard, vendorMark } from './top-models-card.js';

export const ROUTING_SETTINGS_HREF = '/app/resources/routing-settings';
export const COORDINATOR_ROUTE_ANCHOR = 'route-coordinator';
export const COORDINATOR_ROUTING_HREF = `${settingsHref('work-routing')}#${COORDINATOR_ROUTE_ANCHOR}`;

const AGENT_USES: readonly RouteUse[] = ['coordinator'];

const STORED_ONLY_USES: readonly RouteUse[] = ['digest', 'compaction'];

const USE_HINTS: Partial<Record<RouteUse, string>> = {
  coordinator: '你对话的协调者，派活和汇报',
  digest: '每日报告和对话摘要',
  compaction: '上下文快满时压缩对话',
};

const EMPTY_SETTINGS: TeamRoutingSettings = { rules: [], policies: [] };

const modelKey = (option: Pick<ModelOption, 'provider' | 'modelId'>) =>
  JSON.stringify([option.provider, option.modelId]);

const levelLabel = (level: string) => level.charAt(0).toUpperCase() + level.slice(1);

function SessionDefaultHint({
  sessionDefault,
  options,
}: {
  sessionDefault: SessionDefault;
  options: ModelOption[];
}) {
  const { t } = useI18n();
  const row = options.find(
    (o) => o.provider === sessionDefault.provider && o.modelId === sessionDefault.modelId,
  );
  const text =
    sessionDefault.reason === 'claude-code'
      ? t('当前默认：Claude Code（因为有执行机装了 Claude Code）')
      : sessionDefault.reason === 'codex-login'
        ? t('当前默认：Codex（因为有执行机登录了 Codex）')
        : sessionDefault.reason === 'provider'
          ? t(
              '当前默认：{model} · {provider}（因为还没有执行机装 Claude Code，用最早添加的服务商）',
              {
                model: row?.modelName ?? sessionDefault.modelId ?? '',
                provider: row?.providerLabel ?? sessionDefault.provider ?? '',
              },
            )
          : t('当前没有可用的默认：添加服务商，或在执行机上装 Claude Code');
  return <span data-testid="routing-session-default">{text}</span>;
}

function CoordinatorDefaultHint({
  coordinatorDefault,
  options,
}: {
  coordinatorDefault: CoordinatorDefault;
  options: ModelOption[];
}) {
  const { t } = useI18n();
  const row = options.find(
    (o) => o.provider === coordinatorDefault.provider && o.modelId === coordinatorDefault.modelId,
  );
  const vars = {
    model: row?.modelName ?? coordinatorDefault.modelId ?? '',
    provider: row?.providerLabel ?? coordinatorDefault.provider ?? '',
  };
  const text =
    coordinatorDefault.reason === 'anthropic-key'
      ? t('当前默认：{model} · {provider}（因为团队有 Anthropic API key）', vars)
      : coordinatorDefault.reason === 'provider'
        ? t(
            '当前默认：{model} · {provider}（因为这是最早添加、Coordinator 能直接用的服务商）',
            vars,
          )
        : t('当前没有可用的默认：添加一个有 API key 的服务商，或在这里创建规则');
  return <span data-testid="routing-coordinator-default">{text}</span>;
}

type RuleModel = Pick<RoutingRuleRecord, 'provider' | 'modelId'>;

function currentOption(rule: RuleModel | null, options: readonly ModelOption[]) {
  if (rule === null) return undefined;
  if (rule.provider === 'pi') {
    return options.find((o) => o.runtime === 'pi' && o.modelId === rule.modelId);
  }
  return options.find((o) => o.provider === rule.provider && o.modelId === rule.modelId);
}

export function ModelPicker({
  use,
  rule,
  options,
  enabledRuntimes,
  onPick,
  trigger,
}: {
  use: RouteUse;
  rule: RuleModel | null;
  options: ModelOption[];
  enabledRuntimes: ReadonlySet<string> | null;
  onPick: (option: ModelOption) => void;
  trigger?: { label: string; className: string };
}) {
  const { t } = useI18n();
  const picked = currentOption(rule, options);
  const shownId = picked?.modelId ?? rule?.modelId ?? '';
  const Vendor = vendorMark(shownId);
  const byKey = new Map(options.map((o) => [modelKey(o), o]));
  const runtimes = [...new Set(options.map((o) => o.runtime))];
  const coordinatorCannot = (runtime: string) => use === 'coordinator' && runtime !== 'pi';
  const runtimeOff = (runtime: string) =>
    coordinatorCannot(runtime) ||
    (enabledRuntimes !== null && runtime !== 'pi' && !enabledRuntimes.has(runtime));
  const runtimeLabel = (runtime: string) =>
    runtime === 'pi'
      ? t('服务商')
      : (MODEL_SOURCE_RUNTIME_LABELS[runtime as ModelSourceRuntime] ?? runtime);
  return (
    <Select
      value={picked === undefined ? null : modelKey(picked)}
      onValueChange={(next) => {
        const option = next === null ? undefined : byKey.get(next as string);
        if (option !== undefined) onPick(option);
      }}
    >
      <SelectTrigger
        aria-label={
          trigger === undefined
            ? t('{use} 的模型', { use: t(ROUTE_USE_LABELS[use]) })
            : t('{label}（{use} 的模型）', { label: trigger.label, use: t(ROUTE_USE_LABELS[use]) })
        }
        className={
          trigger?.className ??
          'routing-rule-model-select w-auto max-w-64 min-w-0 border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted max-sm:h-7 max-sm:text-meta'
        }
      >
        {trigger !== undefined ? (
          trigger.label
        ) : (
          <SelectValue>
            {shownId === '' ? (
              t('未设置模型')
            ) : (
              <>
                <Vendor aria-hidden className="size-4 flex-none" />
                {picked?.modelName ??
                  options.find((o) => o.modelId === shownId)?.modelName ??
                  shownId}
                {picked === undefined && (
                  <span className="text-content-tertiary">{t('不可用')}</span>
                )}
              </>
            )}
          </SelectValue>
        )}
      </SelectTrigger>
      <SelectContent
        className="routing-rule-model-menu w-max min-w-(--anchor-width) max-w-(--available-width)"
        {...(trigger === undefined ? {} : { alignItemWithTrigger: false, align: 'end' as const })}
      >
        {runtimes.map((runtime) => (
          <SelectGroup key={runtime}>
            <SelectLabel>
              {coordinatorCannot(runtime)
                ? t('{runtime}（Coordinator 用不了）', { runtime: runtimeLabel(runtime) })
                : runtimeOff(runtime)
                  ? t('{runtime}（没有执行机启用）', { runtime: runtimeLabel(runtime) })
                  : runtimeLabel(runtime)}
            </SelectLabel>
            {options
              .filter((o) => o.runtime === runtime)
              .map((o) => (
                <SelectItem
                  key={`${o.machineId ?? ''}/${modelKey(o)}`}
                  className="routing-rule-model-row pointer-coarse:min-h-11"
                  value={modelKey(o)}
                  disabled={o.liveness === 'dead' || runtimeOff(runtime)}
                >
                  {o.liveness === 'dead' ? `${o.modelName}（${t('已下架')}）` : o.modelName}
                  {o.provider !== o.runtime && (
                    <span className="text-meta text-content-tertiary">{o.providerLabel}</span>
                  )}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function RuleRow({
  use,
  label,
  hint,
  rule,
  options,
  enabledRuntimes,
  onSave,
}: {
  use: RouteUse;
  label: string;
  hint: ReactNode;
  rule: RoutingRuleRecord | null;
  options: ModelOption[];
  enabledRuntimes: ReadonlySet<string> | null;
  onSave: (body: {
    provider: string;
    modelId: string;
    thinkingLevel: ThinkingLevel | null;
  }) => void;
}) {
  const { t } = useI18n();
  const level = (rule?.thinkingLevel as ThinkingLevel | null | undefined) ?? 'off';
  return (
    <div
      id={`route-${use}`}
      data-testid={rule === null ? `routing-rule-new-${use}` : `routing-rule-${use}`}
    >
      <SettingsRow label={label} hint={hint} className="flex-wrap gap-y-2 py-2.5">
        <div className="flex items-center justify-end gap-1.5 max-sm:w-full max-sm:justify-start">
          <Select
            value={level}
            disabled={rule === null}
            onValueChange={(next) => {
              if (rule === null || next === null) return;
              onSave({
                provider: rule.provider,
                modelId: rule.modelId,
                thinkingLevel: next === 'off' ? null : (next as ThinkingLevel),
              });
            }}
          >
            <SelectTrigger
              aria-label={t('{use} 的思考强度', { use: label })}
              className="routing-rule-level-select w-auto flex-none max-sm:-ml-2.5 border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted max-sm:h-7 max-sm:text-meta"
            >
              <SelectValue>{levelLabel(level)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {THINKING_LEVELS.map((value) => (
                <SelectItem key={value} value={value}>
                  {levelLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ModelPicker
            use={use}
            rule={rule}
            options={options}
            enabledRuntimes={enabledRuntimes}
            onPick={(option) =>
              onSave({
                provider: option.provider,
                modelId: option.modelId,
                thinkingLevel: level === 'off' ? null : level,
              })
            }
          />
        </div>
      </SettingsRow>
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
  const topModelsQ = useTopModels(teamId, live);
  const topModelMutations = useTopModelsMutations(teamId);
  const settings = live
    ? (settingsQ.data ?? EMPTY_SETTINGS)
    : (fixture.resources?.routingSettings ?? EMPTY_SETTINGS);
  const machineRows = live ? (machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  const enabledRuntimes =
    machineRows.length === 0 ? null : new Set(machineRows.flatMap((m) => m.enabledRuntimes ?? []));
  const options = toModelOptions(
    live ? (modelSourcesQ.data?.sources ?? []) : (fixture.resources?.providerSources ?? []),
  );
  const storedTopModels = live ? topModelsQ.data?.models : fixture.resources?.topModels;
  const topModels = storedTopModels ?? suggestedTopModels(options);
  const { hash } = useLocation();
  const loaded = !live || settingsQ.data !== undefined;
  useEffect(() => {
    if (!loaded || hash === '') return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);
  const ruleOf = (use: RouteUse) => settings.rules.find((rule) => rule.use === use) ?? null;
  const save =
    (use: RouteUse) =>
    (body: { provider: string; modelId: string; thinkingLevel: ThinkingLevel | null }) => {
      if (!live) return;
      mutations.patchRule.mutate(
        { use, body },
        { onError: (error) => toastError(t('保存失败，请重试。'), error) },
      );
    };
  const agentUses = [...AGENT_USES, ...STORED_ONLY_USES.filter((use) => ruleOf(use) !== null)];
  const fixing = mutations.fixRule.isPending ? (mutations.fixRule.variables?.use ?? null) : null;
  const fix = (use: RouteUse, body: RuleFix) => {
    if (!live) return;
    mutations.fixRule.mutate(
      { use, fix: body },
      {
        onError: (error) =>
          toastError(
            error instanceof ApiError && error.status === 409
              ? t('这条规则刚被改过，已重新读取，请再看一眼。')
              : t('修复失败，请重试。'),
            error,
          ),
      },
    );
  };
  const session = ruleOf('session');
  return (
    <PageShell route={ROUTING_SETTINGS_HREF} title={t('模型选择')} fixture={fixture}>
      <QueryBoundary
        query={live ? settingsQ : undefined}
        isEmpty={live && settingsQ.data === undefined}
        loadingLabel={t('正在加载模型选择')}
        errorTitle={t('模型选择没能加载')}
        className="mt-6"
        empty={null}
      >
        <div className="flex flex-col gap-8 pt-1 pb-16">
          <p className="m-0 text-meta text-pretty break-keep text-content-tertiary">
            {t(
              '在这里改常用模型，以及新任务和 Coordinator 用哪个模型、思考多深，改动马上生效。评审等其他用途的模型，在模型路由的图里能看到。',
            )}
          </p>
          <RuleIssueNotices
            issues={settings.ruleIssues ?? []}
            options={options}
            machineName={(id) => machineRows.find((m) => m.id === id)?.name ?? id}
            editableUses={new Set<RouteUse>(['session', ...agentUses])}
            pendingUse={fixing}
            onFix={fix}
          />
          <SettingsCard>
            <RuleRow
              use="session"
              label={t('新任务默认用')}
              hint={
                session === null && settings.sessionDefault !== undefined ? (
                  <SessionDefaultHint sessionDefault={settings.sessionDefault} options={options} />
                ) : (
                  t('新任务用这个模型和思考强度开始')
                )
              }
              rule={session}
              options={options}
              enabledRuntimes={enabledRuntimes}
              onSave={save('session')}
            />
          </SettingsCard>
          {(!live || topModelsQ.data !== undefined) && (
            <TopModelsCard
              models={topModels}
              options={options}
              onChange={(next) => {
                if (!live) return;
                topModelMutations.put.mutate(next, {
                  onError: (error) => toastError(t('保存失败，请重试。'), error),
                });
              }}
              onReset={() => {
                if (!live) return;
                topModelMutations.reset.mutate(undefined, {
                  onError: (error) => toastError(t('保存失败，请重试。'), error),
                });
              }}
            />
          )}
          <SettingsSection testId="routing-agents" title={t('Coordinator 和其他 Agent')}>
            <SettingsCard>
              {agentUses.map((use) => (
                <RuleRow
                  key={use}
                  use={use}
                  label={t(ROUTE_USE_LABELS[use])}
                  hint={
                    use === 'coordinator' && ruleOf(use) === null ? (
                      settings.coordinatorDefault !== undefined ? (
                        <CoordinatorDefaultHint
                          coordinatorDefault={settings.coordinatorDefault}
                          options={options}
                        />
                      ) : (
                        t('先给 Coordinator 选模型，它才能回答你的消息。')
                      )
                    ) : (
                      t(USE_HINTS[use] ?? '')
                    )
                  }
                  rule={ruleOf(use)}
                  options={options}
                  enabledRuntimes={enabledRuntimes}
                  onSave={save(use)}
                />
              ))}
            </SettingsCard>
          </SettingsSection>
        </div>
      </QueryBoundary>
    </PageShell>
  );
}
