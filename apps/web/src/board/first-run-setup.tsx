import type { CoordinatorDefault, RoutingRuleRecord, SessionDefault } from '@cairn/shared';
import { cn } from 'cn';
import { Check, KeyRound, MessageSquare, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useChief, useMachines, useModelSources, useProjects, useProviders } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { useModelRouting } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { BrandGlyph } from '../components/brand-glyph.js';
import { SegmentedRadio } from '../components/segmented.js';
import { SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError } from '../components/ui/toaster.js';
import type { ModelOption } from '../fixtures/records.js';
import { LOCALE_NAMES, LOCALES } from '../i18n/locale.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { BRAND_GLYPH } from '../lib/brand-mark.js';
import { AddProviderFlow, type AddProviderView } from '../resources/add-provider-flow.js';
import { ModelPicker } from '../resources/routing-settings-page.js';
import { safeSessionStorage } from '../safe-storage.js';
import {
  coordinatorCanAnswer,
  modelSides,
  modelSourceCount,
  modelsConfirmed,
  type SetupProgress,
  type SetupStepId,
  setupOpenStep,
} from './first-run-checklist-model.js';

export const SETUP_PARAM = 'setup';
export const SETUP_HREF = `/app?${SETUP_PARAM}=1`;
const SKIP_KEY = 'cairn.firstRunSetupSkipped';

export function setupSkipped(): boolean {
  return safeSessionStorage()?.getItem(SKIP_KEY) === '1';
}

function skipSetup(): void {
  try {
    safeSessionStorage()?.setItem(SKIP_KEY, '1');
  } catch {}
}

export function useFirstRunSetup() {
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const providersQ = useProviders(teamId, live);
  const routingQ = useModelRouting(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const chiefQ = useChief(teamId, live);
  const settingsQ = useRoutingSettings(teamId, live);
  const sourcesQ = useModelSources(teamId, live);
  const connections = routingQ.data === undefined ? undefined : (routingQ.data.connections ?? []);
  const models = modelSides(
    coordinatorCanAnswer(chiefQ.data),
    modelSourceCount(providersQ.data?.providers, connections),
  );
  const settings = settingsQ.data;
  const progress: SetupProgress | undefined =
    models === undefined || settings === undefined
      ? undefined
      : { models, confirmed: modelsConfirmed({ ...settings, rules: settings.rules ?? [] }) };
  return {
    live,
    teamId,
    projects: live ? projectsQ.data?.length : undefined,
    progress,
    connections: connections ?? [],
    machines: machinesQ.data ?? [],
    settings,
    options: toModelOptions(sourcesQ.data?.sources ?? []),
    claudeCodeFound: (sourcesQ.data?.sources ?? []).some(
      (source) => source.runtime === 'claude-code' && source.installed,
    ),
  };
}

type Setup = ReturnType<typeof useFirstRunSetup>;

const LG_PAD = 'lg:pl-14';

function StepMark({ n, state, className }: { n: number; state: StepState; className?: string }) {
  const { t } = useI18n();
  if (state === 'done') {
    return (
      <span
        role="img"
        aria-label={t('已完成')}
        className={cn(
          'grid size-6 flex-none place-items-center rounded-full bg-content-tertiary text-background',
          className,
        )}
      >
        <Check className="size-4" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-6 flex-none place-items-center rounded-full bg-background font-mono text-meta',
        state === 'now'
          ? 'border border-(--card-button) text-foreground'
          : 'border border-dashed border-content-dim text-content-tertiary',
        className,
      )}
    >
      {n}
    </span>
  );
}

type StepState = 'done' | 'now' | 'open';

function SourceRow({
  icon,
  title,
  status,
  usedBy,
  action,
}: {
  icon: ReactNode;
  title: string;
  status: ReactNode;
  usedBy: string;
  action?: ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-10 flex-none place-items-center rounded-(--radius-tile) bg-background text-content-secondary ring-1 ring-border">
          {icon}
        </span>
        <div className="min-w-0 flex-1 text-pretty">
          <div className="break-keep text-foreground">
            <span className="font-title">{title}</span>
            <span className="mx-1 text-meta text-content-tertiary">·</span>
            <span className="text-meta text-content-tertiary">{usedBy}</span>
          </div>
          <div className="break-keep text-meta text-content-secondary">{status}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

function ModelsBody({ setup, progress }: { setup: Setup; progress: SetupProgress }) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const [addView, setAddView] = useState<AddProviderView>('closed');
  const [connectError, setConnectError] = useState<string | null>(null);
  const hasProvider = progress.models.coordinator;
  const subscriptionSaved = setup.connections.some(
    (connection) =>
      connection.kind === 'subscription' &&
      connection.available !== false &&
      !connection.id.startsWith('machine:'),
  );
  const status = hasProvider
    ? t('已添加，Coordinator 能用')
    : subscriptionSaved && !setup.claudeCodeFound
      ? t('订阅已保存。这台电脑还没找到 Claude Code，装好它之后会自动用上。')
      : t('Claude 订阅、API key 或本地模型');
  return (
    <>
      <SettingsCard>
        <SourceRow
          icon={<KeyRound className="size-5" />}
          title={t('服务商')}
          status={status}
          usedBy={t('Coordinator 和任务都能用')}
          action={
            hasProvider ? undefined : (
              <div className={cn('mt-5', LG_PAD)}>
                <Button
                  size="lg"
                  className="px-4 pointer-coarse:h-11 max-lg:h-11 max-lg:w-full"
                  data-testid="first-run-add-provider"
                  onClick={() => setAddView('picker')}
                >
                  <Plus />
                  {t('添加服务商')}
                </Button>
              </div>
            )
          }
        />
      </SettingsCard>
      <AddProviderFlow
        teamId={setup.teamId}
        live={live}
        view={addView}
        onViewChange={setAddView}
        connectError={connectError}
        onConnectError={setConnectError}
      />
    </>
  );
}

interface Pick {
  use: 'coordinator' | 'session';
  provider: string;
  modelId: string;
  stored: boolean;
  why: string;
}

function coordinatorWhy(reason: CoordinatorDefault['reason'], t: TFunc): string {
  return reason === 'anthropic-key'
    ? t('因为你添加了 Anthropic API key')
    : reason === 'claude-code'
      ? t('因为你登录了 Claude 订阅，Coordinator 直接用它')
      : t('因为这是最早添加、Coordinator 能直接用的服务商');
}

function sessionWhy(reason: SessionDefault['reason'], t: TFunc): string {
  return reason === 'claude-code'
    ? t('因为这台电脑登录了 Claude Code，任务直接用订阅额度')
    : reason === 'codex-login'
      ? t('因为这台电脑登录了 Codex')
      : t('因为还没有 Claude Code，用最早添加的服务商');
}

function pickOf(
  use: Pick['use'],
  rules: readonly RoutingRuleRecord[],
  fallback: { provider: string | null; modelId: string | null } | undefined,
  why: string,
  t: TFunc,
): Pick | null {
  const rule = rules.find((r) => r.use === use);
  if (rule !== undefined) {
    return { use, provider: rule.provider, modelId: rule.modelId, stored: true, why: t('已保存') };
  }
  if (fallback?.provider == null || fallback.modelId == null) return null;
  return { use, provider: fallback.provider, modelId: fallback.modelId, stored: false, why };
}

function picksOf(setup: Setup, t: TFunc): (Pick | null)[] {
  const rules = setup.settings?.rules ?? [];
  const coordinator = setup.settings?.coordinatorDefault;
  const session = setup.settings?.sessionDefault;
  return [
    pickOf(
      'coordinator',
      rules,
      coordinator,
      coordinator ? coordinatorWhy(coordinator.reason, t) : '',
      t,
    ),
    pickOf('session', rules, session, session ? sessionWhy(session.reason, t) : '', t),
  ];
}

function modelLabel(pick: Pick, options: readonly ModelOption[]): [string, string] {
  const row = options.find((o) => o.provider === pick.provider && o.modelId === pick.modelId);
  return [row?.modelName ?? pick.modelId, row?.providerLabel ?? pick.provider];
}

function ConfirmBody({ setup }: { setup: Setup }) {
  const { t } = useI18n();
  const { patchRule } = useRoutingSettingsMutations(setup.teamId);
  const [changed, setChanged] = useState<Partial<Record<Pick['use'], ModelOption>>>({});
  const suggested = picksOf(setup, t);
  const picks = suggested.map((pick, i) => {
    const use: Pick['use'] = i === 0 ? 'coordinator' : 'session';
    const option = changed[use];
    if (option === undefined) return pick;
    return {
      use,
      provider: option.provider,
      modelId: option.modelId,
      stored: false,
      why:
        pick == null
          ? t('你换的')
          : t('你换的，原本推荐 {model}', { model: modelLabel(pick, setup.options)[0] }),
    };
  });
  const pickFor = (use: Pick['use'], index: number) => (option: ModelOption) => {
    const original = suggested[index];
    const same =
      original != null &&
      original.provider === option.provider &&
      original.modelId === option.modelId;
    setChanged((prev) => {
      const { [use]: _, ...rest } = prev;
      return same ? rest : { ...rest, [use]: option };
    });
  };
  const enabledRuntimes =
    setup.machines.length === 0
      ? null
      : new Set(setup.machines.flatMap((machine) => machine.enabledRuntimes ?? []));
  const rows = [
    {
      use: 'coordinator' as const,
      who: t('Coordinator'),
      what: t('和你对话、拆任务、派活'),
      pick: picks[0],
    },
    {
      use: 'session' as const,
      who: t('新任务'),
      what: t('写代码和做调研的 Agent 默认用它'),
      pick: picks[1],
    },
  ];
  const ready = picks.every((p) => p != null);
  const confirm = async () => {
    try {
      for (const p of picks) {
        if (p == null || p.stored) continue;
        await patchRule.mutateAsync({
          use: p.use,
          body: { provider: p.provider, modelId: p.modelId },
        });
      }
      setChanged({});
    } catch (error) {
      toastError(t('保存失败，请重试。'), error);
    }
  };
  return (
    <>
      <p className="m-0 mt-2 text-pretty break-keep text-content-secondary">
        {t('Cairn 按你接入的模型挑了这两个。确认后才会保存，以后可以在设置里改。')}
      </p>
      <SettingsCard className="mt-5">
        {rows.map(({ use, who, what, pick }, index) => {
          const [model, provider] = pick == null ? [null, null] : modelLabel(pick, setup.options);
          return (
            <div key={who} data-testid={`first-run-pick-${use}`} className="px-5 py-4">
              <div className="text-pretty break-keep">
                <span className="text-foreground">{who}</span>
                <span className="mx-1 text-meta text-content-tertiary">·</span>
                <span className="text-meta text-content-tertiary">{what}</span>
              </div>
              <div className="mt-1 flex min-h-6 flex-wrap items-center gap-x-2">
                {pick == null ? (
                  <span className="text-meta text-destructive">{t('还没有能用的模型')}</span>
                ) : (
                  <>
                    <span className="text-card-title font-title text-foreground">{model}</span>
                    <span className="text-meta text-content-secondary">{provider}</span>
                  </>
                )}
                <span className="ml-auto">
                  <ModelPicker
                    use={use}
                    rule={pick ?? null}
                    options={setup.options}
                    enabledRuntimes={enabledRuntimes}
                    onPick={pickFor(use, index)}
                    trigger={{
                      label: t('换一个'),
                      className:
                        'h-6 gap-1 rounded-sm border-0 bg-transparent p-0 text-ui text-foreground underline decoration-content-tertiary underline-offset-4 hover:decoration-current data-[size=default]:h-6 dark:bg-transparent dark:hover:bg-transparent pointer-coarse:h-11 pointer-coarse:data-[size=default]:h-11',
                    }}
                  />
                </span>
              </div>
              {pick != null && (
                <div className="mt-1 text-pretty break-keep text-meta text-content-tertiary">
                  {pick.why}
                </div>
              )}
            </div>
          );
        })}
      </SettingsCard>
      <div className="mt-5">
        <Button
          data-testid="first-run-confirm"
          size="lg"
          className="px-4 pointer-coarse:h-11 max-lg:h-11 max-lg:w-full"
          disabled={!ready || patchRule.isPending}
          onClick={() => void confirm()}
        >
          {patchRule.isPending && <Spinner className="size-5" />}
          {patchRule.isPending ? t('保存中…') : t('确认并开始对话')}
        </Button>
      </div>
    </>
  );
}

function Watermark() {
  const { box, scale, offset, d } = BRAND_GLYPH.large;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${box} ${box}`}
      className="pointer-events-none absolute -top-50 -right-48 size-120 text-(--tree-line) max-lg:hidden"
    >
      <g
        transform={`translate(${box / 2} ${box / 2}) scale(${scale}) translate(${offset[0]} ${offset[1]})`}
      >
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}

function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <SegmentedRadio
      label={t('语言')}
      value={locale}
      onChange={setLocale}
      optionHandle="dark:data-active:bg-(--sidebar-active)"
      options={LOCALES.map((code) => ({
        value: code,
        label: LOCALE_NAMES[code],
        testId: `first-run-locale-${code}`,
      }))}
    />
  );
}

function SkipLine({ onSkip, className }: { onSkip: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <p className={cn('m-0 text-pretty break-keep text-meta text-content-tertiary', className)}>
      {t('不急的话可以')}
      <Button
        variant="link"
        className="inline-flex h-auto min-h-6 p-0 align-baseline text-meta font-normal text-foreground underline decoration-content-tertiary underline-offset-4 pointer-coarse:-my-3 pointer-coarse:py-3"
        onClick={() => {
          skipSetup();
          onSkip();
        }}
      >
        {t('先跳过，去主页看看')}
      </Button>
      {t('，下次打开 Cairn 时这页还在。')}
    </p>
  );
}

function stateOf(step: SetupStepId, open: SetupStepId): StepState {
  return open === step ? 'now' : step === 'models' ? 'done' : 'open';
}

function Rail({ open }: { open: SetupStepId }) {
  const { t } = useI18n();
  const steps = [
    {
      n: 1,
      id: 'models' as const,
      title: t('接入模型'),
      sub: open === 'models' ? t('接一个服务商就够') : t('Coordinator 和任务都有模型'),
    },
    {
      n: 2,
      id: 'confirm' as const,
      title: t('确认模型'),
      sub: t('选 Coordinator 和新任务用哪个模型'),
    },
  ];
  return (
    <ol className="m-0 mt-12 list-none p-0 max-lg:hidden">
      {steps.map(({ n, id, title, sub }) => {
        const state = stateOf(id, open);
        return (
          <li
            key={id}
            data-testid={`first-run-step-${n}`}
            data-state={state}
            aria-current={state === 'now' ? 'step' : undefined}
            className="relative grid grid-cols-[1.5rem_1fr] gap-x-4 pb-7 before:absolute before:top-7 before:bottom-1 before:left-3 before:w-px before:bg-(--tree-line) before:content-[''] data-[state=done]:before:bg-content-tertiary"
          >
            <StepMark n={n} state={state} />
            <div className="min-w-0 text-pretty">
              <div
                className={cn(
                  'text-card-title font-title',
                  state === 'open' ? 'text-content-secondary' : 'text-foreground',
                )}
              >
                {title}
              </div>
              <div className="text-meta text-content-tertiary">{sub}</div>
            </div>
          </li>
        );
      })}
      <li className="grid grid-cols-[1.5rem_1fr] gap-x-4">
        <span className="grid size-6 place-items-center rounded-full border border-dashed border-content-dim text-content-tertiary">
          <MessageSquare className="size-4" />
        </span>
        <div className="min-w-0 text-pretty">
          <div className="text-card-title font-title text-content-secondary">
            {t('开始和 Coordinator 对话')}
          </div>
          <div className="text-meta text-content-tertiary">{t('两步做完就直接进入对话')}</div>
        </div>
      </li>
    </ol>
  );
}

function Segments({ open }: { open: SetupStepId }) {
  const { t } = useI18n();
  return (
    <ol className="m-0 mt-6 grid list-none grid-cols-2 gap-2 p-0 lg:hidden">
      {(['models', 'confirm'] as const).map((id) => {
        const state = stateOf(id, open);
        return (
          <li
            key={id}
            aria-current={state === 'now' ? 'step' : undefined}
            className={cn(
              'h-1 rounded-full',
              state === 'done'
                ? 'bg-content-tertiary'
                : state === 'now'
                  ? 'bg-(--card-button)'
                  : 'bg-border',
            )}
          >
            <span className="sr-only">{id === 'models' ? t('接入模型') : t('确认模型')}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function FirstRunSetup({ setup, onSkip }: { setup: Setup; onSkip: () => void }) {
  const { t } = useI18n();
  const progress = setup.progress;
  if (progress === undefined) return null;
  const open = setupOpenStep(progress);
  if (open === null) return null;
  return (
    <main
      data-testid="first-run-setup"
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto bg-background text-foreground lg:flex-row lg:overflow-hidden"
    >
      <div aria-hidden="true" className="first-run-drag absolute inset-x-0 top-0 h-10" />
      <div className="absolute top-12 right-8 z-1 max-lg:hidden">
        <LanguageSwitch />
      </div>
      <aside className="relative flex flex-none flex-col px-5 pt-[calc(env(safe-area-inset-top)+3rem)] lg:max-w-150 lg:basis-2/5 lg:overflow-hidden lg:border-r lg:border-border lg:bg-(--surface-1) lg:px-18 lg:pt-12 lg:pb-10">
        <Watermark />
        <div className="relative flex h-8 items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BrandGlyph className="size-5" />
            <span className="voice-title text-brand">Cairn</span>
          </div>
          <div className="lg:hidden">
            <LanguageSwitch />
          </div>
        </div>
        <div className="relative flex flex-col lg:flex-1 lg:justify-center">
          <h1 className="m-0 mt-8 voice-greeting text-greeting text-balance lg:mt-0">
            {t('欢迎使用 Cairn')}
          </h1>
          <p className="m-0 mt-3 max-w-105 text-balance break-keep text-content-secondary">
            {t('Cairn 在这台电脑上跑 Agent，用你自己的模型。配好模型就能开始对话。')}
          </p>
          <Rail open={open} />
          <Segments open={open} />
        </div>
        <SkipLine onSkip={onSkip} className="relative max-lg:hidden" />
      </aside>
      <div className="flex flex-1 flex-col px-5 pt-8 pb-[calc(env(safe-area-inset-bottom)+2rem)] lg:items-center lg:justify-center lg:overflow-y-auto lg:p-16">
        <section
          key={open}
          aria-label={open === 'models' ? t('接入模型') : t('确认模型')}
          className="w-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 lg:min-h-96 lg:max-w-130"
        >
          <h2 className="m-0 voice-response text-page">
            {open === 'models' ? t('接入模型') : t('确认模型')}
          </h2>
          {open === 'models' ? (
            <div className="mt-5">
              <ModelsBody setup={setup} progress={progress} />
            </div>
          ) : (
            <ConfirmBody setup={setup} />
          )}
        </section>
        <SkipLine onSkip={onSkip} className="mt-auto pt-10 lg:hidden" />
      </div>
    </main>
  );
}
