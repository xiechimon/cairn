import {
  type CoordinatorDefault,
  type RouteUse,
  type RoutingRuleRecord,
  type RuleFix,
  type SessionDefault,
  type TeamRoutingSettings,
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@cairn/shared';
import { Box, ChevronRight } from 'lucide-react';
import { type ComponentType, type ReactNode, type SVGProps, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useMachines, useModelSources, useProjects } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { ROUTE_USE_LABELS } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import {
  ClaudeMark,
  DevinMark,
  GeminiMark,
  GrokMark,
  OpenAIMark,
} from '../components/brand-marks.js';
import { FilterPicker } from '../components/filter-picker.js';
import { modelGroupKey, modelGroupName } from '../components/model-select-core.js';
import { QueryBoundary } from '../components/query-state.js';
import { SettingsCard, SettingsRow } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import type { ModelOption } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { settingsHref } from '../settings/settings-href.js';
import { RuleIssueNotices } from './rule-issue-notices.js';

export const ROUTING_SETTINGS_HREF = '/app/resources/routing-settings';
export const COORDINATOR_ROUTE_ANCHOR = 'route-coordinator';
export const COORDINATOR_ROUTING_HREF = `${settingsHref('routing')}#${COORDINATOR_ROUTE_ANCHOR}`;

const AGENT_USES: readonly RouteUse[] = ['coordinator'];

const STORED_ONLY_USES: readonly RouteUse[] = ['digest', 'compaction'];

const USE_HINTS: Partial<Record<RouteUse, string>> = {
  coordinator: '和你对话、派活',
  digest: '对话摘要',
  compaction: '上下文快满时压缩对话',
};

const EMPTY_SETTINGS: TeamRoutingSettings = { rules: [], policies: [] };

const modelKey = (option: Pick<ModelOption, 'provider' | 'modelId'>) =>
  JSON.stringify([option.provider, option.modelId]);

const FOLLOW_DEFAULT = 'follow-default';

const levelLabel = (level: string) => level.charAt(0).toUpperCase() + level.slice(1);

function vendorMark(modelId: string): ComponentType<SVGProps<SVGSVGElement>> {
  if (modelId.startsWith('claude')) return ClaudeMark;
  if (modelId.startsWith('devin')) return DevinMark;
  if (/^(gpt|o\d|codex)/.test(modelId)) return OpenAIMark;
  if (modelId.startsWith('gemini')) return GeminiMark;
  if (modelId.startsWith('grok')) return GrokMark;
  return Box;
}

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
      ? t('当前默认：Claude Code（因为团队有 Claude 订阅，执行机也装了 Claude Code）')
      : sessionDefault.reason === 'provider'
        ? t(
            '当前默认：{model} · {provider}（因为还没有 Claude 订阅或装了 Claude Code 的执行机，用最早添加的服务商）',
            {
              model: row?.modelName ?? sessionDefault.modelId ?? '',
              provider: row?.providerLabel ?? sessionDefault.provider ?? '',
            },
          )
        : t('当前没有可用的默认：添加服务商，或添加 Claude 订阅并在执行机上装 Claude Code');
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
  const Vendor = vendorMark(shownId);
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
  const devinPicked = currentOption(rule, options)?.runtime === 'devin';
  const level = devinPicked
    ? 'off'
    : ((rule?.thinkingLevel as ThinkingLevel | null | undefined) ?? 'off');
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
          {!devinPicked && (followDefault === undefined || rule !== null) && (
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
                <SelectValue>
                  <span className="text-content-tertiary">{t('思考')}</span>
                  {levelLabel(level)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {THINKING_LEVELS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {levelLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                thinkingLevel: option.runtime === 'devin' || level === 'off' ? null : level,
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
  const projects = (projectsQ.data ?? []).filter(
    (p) => p.modelOverrides?.coordinator != null || p.modelOverrides?.session != null,
  );
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
            const parts = [
              p.modelOverrides?.coordinator != null
                ? `Coordinator · ${nameOf(p.modelOverrides.coordinator)}`
                : null,
              p.modelOverrides?.session != null
                ? `${t('任务')} · ${nameOf(p.modelOverrides.session)}`
                : null,
            ].filter((part): part is string => part !== null);
            return (
              <SettingsRow key={p.id} label={p.name} hint={parts.join('　')}>
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
  const session = ruleOf('session');
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
                    t('先给 Coordinator 选模型，它才能回答你的消息。')
                  )
                ) : (
                  t(USE_HINTS[use] ?? '')
                )
              }
              rule={ruleOf(use)}
              options={options}
              onSave={save(use)}
            />
          ))}
          <RuleRow
            use="session"
            label={t('任务')}
            hint={
              session === null && settings.sessionDefault !== undefined ? (
                <SessionDefaultHint sessionDefault={settings.sessionDefault} options={options} />
              ) : (
                t('执行每个任务')
              )
            }
            rule={session}
            options={options}
            onSave={save('session')}
          />
        </SettingsCard>
        <ProjectOverrides options={options} />
      </div>
    </QueryBoundary>
  );
}
