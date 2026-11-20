import type {
  CoordinatorDefault,
  RouteUse,
  RoutingRuleRecord,
  RuleFix,
  TeamRoutingSettings,
  ThinkingLevel,
  TopModel,
} from '@cairn/shared';
import { ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useFrequentModels, useFrequentModelsMutations } from '../api/frequent-models.js';
import { useMachines, useModelSources, useProjects } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { ROUTE_USE_LABELS } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { FilterPicker } from '../components/filter-picker.js';
import { InfoTip } from '../components/info-tip.js';
import { modelGroupKey, modelGroupName } from '../components/model-select-core.js';
import { QueryBoundary } from '../components/query-state.js';
import { SettingsCard, SettingsRow } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import type { ModelOption } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { FrequentModelsCard, vendorMark } from './frequent-models-card.js';
import { RuleIssueNotices } from './rule-issue-notices.js';
import { ThinkingLevelSelect } from './thinking-level-select.js';

const AGENT_USES: readonly RouteUse[] = ['coordinator'];

const STORED_ONLY_USES: readonly RouteUse[] = ['compaction'];

const USE_HINTS: Partial<Record<RouteUse, string>> = {
  compaction: '上下文快满时压缩对话',
};

const EMPTY_SETTINGS: TeamRoutingSettings = { rules: [], policies: [] };

const modelKey = (option: Pick<ModelOption, 'provider' | 'modelId'>) =>
  JSON.stringify([option.provider, option.modelId]);

const FOLLOW_DEFAULT = 'follow-default';

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
  const known = coordinatorDefault.reason !== 'none' && vars.model !== '';
  return (
    <span data-testid="routing-coordinator-default">
      {known
        ? t('当前默认：{model} · {provider}', vars)
        : t('当前没有可用的默认：添加一个有 API key 的服务商，或在这里创建规则')}
      {known && coordinatorDefault.reason === 'anthropic-key' && (
        <InfoTip className="ml-1.5" info={t('因为团队有 Anthropic API key')} />
      )}
      {known && coordinatorDefault.reason === 'provider' && (
        <InfoTip className="ml-1.5" info={t('因为这是最早添加、Coordinator 能直接用的服务商')} />
      )}
    </span>
  );
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
  onPick,
  trigger,
  followDefault,
}: {
  use: RouteUse;
  rule: RuleModel | null;
  options: ModelOption[];
  onPick: (option: ModelOption) => void;
  trigger?: { label: string; className: string };
  followDefault?: { label: string; detail: string | null; onPick: () => void };
}) {
  const { t } = useI18n();
  const picked = currentOption(rule, options);
  const shownId = picked?.modelId ?? rule?.modelId ?? '';
  const Vendor = vendorMark({ runtime: picked?.runtime ?? rule?.provider ?? '', modelId: shownId });
  const byKey = new Map(options.map((o) => [modelKey(o), o]));
  const rows = [...byKey.values()];
  return (
    <FilterPicker
      options={[
        ...(followDefault === undefined
          ? []
          : [
              {
                value: FOLLOW_DEFAULT,
                label: followDefault.label,
                group: FOLLOW_DEFAULT,
                groupLabel: '',
              },
            ]),
        ...rows.map((o) => ({
          value: modelKey(o),
          label: o.liveness === 'dead' ? `${o.modelName}（${t('已下架')}）` : o.modelName,
          detail: modelGroupName(o),
          group: modelGroupKey(o),
          groupLabel: modelGroupName(o),
          disabled: o.liveness === 'dead',
          keywords: `${o.modelId} ${o.runtime}`,
        })),
      ]}
      value={
        picked !== undefined
          ? modelKey(picked)
          : followDefault !== undefined && rule === null
            ? FOLLOW_DEFAULT
            : null
      }
      onPick={(key) => {
        if (key === FOLLOW_DEFAULT) {
          followDefault?.onPick();
          return;
        }
        const option = byKey.get(key);
        if (option !== undefined) onPick(option);
      }}
      label={
        trigger === undefined
          ? t('{use} 的模型', { use: t(ROUTE_USE_LABELS[use]) })
          : t('{label}（{use} 的模型）', { label: trigger.label, use: t(ROUTE_USE_LABELS[use]) })
      }
      placeholder={t('搜索模型或服务商')}
      noun={t('模型')}
      align="end"
      triggerClassName={
        trigger?.className ??
        'routing-rule-model-select w-auto max-w-72 min-w-0 border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted max-sm:h-7 max-sm:max-w-full max-sm:text-meta'
      }
      triggerContent={
        trigger !== undefined ? (
          trigger.label
        ) : followDefault !== undefined && rule === null ? (
          <>
            <span className="flex-none truncate">{followDefault.label}</span>
            {followDefault.detail !== null && (
              <span className="min-w-0 truncate text-meta text-content-tertiary">
                {followDefault.detail}
              </span>
            )}
          </>
        ) : shownId === '' ? (
          t('未设置模型')
        ) : (
          <>
            <Vendor aria-hidden className="size-4 flex-none" />
            <span className="max-w-full flex-none truncate">
              {picked?.modelName ??
                options.find((o) => o.modelId === shownId)?.modelName ??
                shownId}
            </span>
            {picked === undefined ? (
              <span className="text-content-tertiary">{t('不可用')}</span>
            ) : (
              <span className="min-w-0 truncate text-meta text-content-tertiary">
                {modelGroupName(picked)}
              </span>
            )}
          </>
        )
      }
      popupClassName="routing-rule-model-menu"
      rowClassName="routing-rule-model-row"
    />
  );
}

export function RuleRow({
  use,
  label,
  hint,
  rule,
  options,
  onSave,
  followDefault,
  testId,
}: {
  use: RouteUse;
  label: string;
  hint: ReactNode;
  rule: (RuleModel & Partial<Pick<RoutingRuleRecord, 'thinkingLevel'>>) | null;
  options: ModelOption[];
  onSave: (body: {
    provider: string;
    modelId: string;
    thinkingLevel: ThinkingLevel | null;
  }) => void;
  followDefault?: { label: string; detail: string | null; onPick: () => void };
  testId?: string;
}) {
  const { t } = useI18n();
  const picked = currentOption(rule, options);
  return (
    <div
      id={testId === undefined ? `route-${use}` : undefined}
      data-testid={testId ?? (rule === null ? `routing-rule-new-${use}` : `routing-rule-${use}`)}
    >
      <SettingsRow
        label={label}
        hint={hint}
        className="flex-wrap gap-y-2 py-2.5 max-sm:[&>span:first-child]:max-w-none"
        hintClassName="text-pretty break-keep"
      >
        <div className="flex items-center justify-end gap-1.5 max-sm:w-full max-sm:justify-start">
          {rule !== null && picked !== undefined && (
            <ThinkingLevelSelect
              levels={picked.coordinatorThinkingLevels}
              resolvesTo={picked.coordinatorThinkingDefault}
              value={rule.thinkingLevel ?? null}
              onChange={(thinkingLevel) =>
                onSave({ provider: rule.provider, modelId: rule.modelId, thinkingLevel })
              }
              label={t('{use} 的思考强度', { use: label })}
              className="routing-rule-level-select max-sm:-ml-2.5"
            />
          )}
          <ModelPicker
            use={use}
            rule={rule}
            options={options}
            {...(followDefault !== undefined ? { followDefault } : {})}
            onPick={(option) =>
              onSave({
                provider: option.provider,
                modelId: option.modelId,
                thinkingLevel:
                  option.coordinatorThinkingLevels?.find(
                    (known) => known === rule?.thinkingLevel,
                  ) ?? null,
              })
            }
          />
        </div>
      </SettingsRow>
    </div>
  );
}

function ProjectOverrides({ options }: { options: ModelOption[] }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const [open, setOpen] = useState(false);
  const projects = (projectsQ.data ?? []).filter((p) => p.modelOverrides?.coordinator != null);
  if (projects.length === 0) return null;
  const nameOf = (choice: RuleModel) => currentOption(choice, options)?.modelName ?? choice.modelId;
  return (
    <div data-testid="routing-project-overrides" className="-mt-5 flex flex-col gap-2">
      <Button
        variant="link"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-auto min-h-6 w-fit gap-1 px-1 font-normal text-meta text-content-secondary no-underline hover:text-foreground hover:no-underline pointer-coarse:min-h-11"
      >
        {t('{count} 个项目单独设置了模型', { count: projects.length })}
        <ChevronRight
          aria-hidden
          className={
            open ? 'size-4 rotate-90 text-content-tertiary' : 'size-4 text-content-tertiary'
          }
        />
      </Button>
      {open && (
        <SettingsCard>
          {projects.map((p) => {
            const choice = p.modelOverrides?.coordinator;
            if (choice == null) return null;
            return (
              <SettingsRow key={p.id} label={p.name} hint={`Coordinator · ${nameOf(choice)}`}>
                <Link
                  to={`/app/project/${p.id}/settings`}
                  className="text-ui text-foreground underline decoration-content-tertiary underline-offset-4 hover:decoration-current"
                >
                  {t('项目设置')}
                </Link>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      )}
    </div>
  );
}

export function ModelRulesSection() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const settingsQ = useRoutingSettings(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const modelSourcesQ = useModelSources(teamId, live);
  const mutations = useRoutingSettingsMutations(teamId);
  const frequentQ = useFrequentModels(teamId, live);
  const frequentMutations = useFrequentModelsMutations(teamId);
  const [fixtureFrequent, setFixtureFrequent] = useState(fixture.resources?.topModels ?? []);
  const frequent = live ? (frequentQ.data?.models ?? []) : fixtureFrequent;
  const saveFrequent = (next: TopModel[]) => {
    if (!live) {
      setFixtureFrequent(next);
      return;
    }
    frequentMutations.put.mutate(next, {
      onError: (error) => toastError(t('保存失败，请重试。'), error),
    });
  };
  const settings = live
    ? (settingsQ.data ?? EMPTY_SETTINGS)
    : (fixture.resources?.routingSettings ?? EMPTY_SETTINGS);
  const machineRows = live ? (machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  const options = toModelOptions(
    live ? (modelSourcesQ.data?.sources ?? []) : (fixture.resources?.providerSources ?? []),
  );
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
  return (
    <QueryBoundary
      query={live ? settingsQ : undefined}
      isEmpty={live && settingsQ.data === undefined}
      loadingLabel={t('正在加载模型')}
      errorTitle={t('模型没能加载')}
      empty={null}
    >
      <div className="flex flex-col gap-8">
        <RuleIssueNotices
          issues={settings.ruleIssues ?? []}
          options={options}
          machineName={(id) => machineRows.find((m) => m.id === id)?.name ?? id}
          editableUses={new Set<RouteUse>(['session', ...agentUses])}
          pendingUse={fixing}
          onFix={fix}
        />
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
                    <>
                      {t('先给 Coordinator 选模型')}
                      <InfoTip
                        className="ml-1.5"
                        info={t('Coordinator 要有模型才能回答你的消息')}
                      />
                    </>
                  )
                ) : USE_HINTS[use] === undefined ? undefined : (
                  t(USE_HINTS[use])
                )
              }
              rule={ruleOf(use)}
              options={options}
              onSave={save(use)}
            />
          ))}
        </SettingsCard>
        <FrequentModelsCard models={frequent} options={options} onChange={saveFrequent} />
        <ProjectOverrides options={options} />
      </div>
    </QueryBoundary>
  );
}
