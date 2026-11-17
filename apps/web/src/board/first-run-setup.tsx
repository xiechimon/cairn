import type { RoutingRuleRecord } from '@cairn/shared';
import { cn } from 'cn';
import { Check, KeyRound } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  useApiMutations,
  useChief,
  useComputers,
  useMachines,
  useModelSources,
  useProjects,
  useProviders,
} from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { useModelRouting } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { BrandGlyph } from '../components/brand-glyph.js';
import { InkSpiral, type SpiralHang } from '../components/ink-spiral.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { SegmentedRadio } from '../components/segmented.js';
import { SettingsCard } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError } from '../components/ui/toaster.js';
import type { ModelOption } from '../fixtures/records.js';
import { LOCALE_NAMES, LOCALES } from '../i18n/locale.js';
import { useI18n } from '../i18n/provider.js';
import { AddProviderFlow, type AddProviderView } from '../resources/add-provider-flow.js';
import { ModelPicker } from '../resources/routing-settings-page.js';
import { safeLocalStorage, safeSessionStorage } from '../safe-storage.js';
import {
  coordinatorCanAnswer,
  modelSides,
  modelSourceCount,
  modelsConfirmed,
  type SetupProgress,
  type SetupStepId,
  setupOpenStep,
} from './first-run-checklist-model.js';
import { LocalProviderImportCard } from './local-provider-import.js';
import { formatDownloadBytes } from './machines-panel.js';

export const SETUP_PARAM = 'setup';
export const SETUP_HREF = `/app?${SETUP_PARAM}=1`;
const SKIP_KEY = 'cairn.firstRunSetupSkipped';

export function setupSkipped(): boolean {
  return safeSessionStorage()?.getItem(SKIP_KEY) === '1';
}

export const FIRST_RUN_OPEN_KEY = 'cairn.firstRunOpen';

export function firstRunRemembered(): boolean {
  return safeLocalStorage()?.getItem(FIRST_RUN_OPEN_KEY) === '1';
}

export function rememberFirstRun(open: boolean): void {
  try {
    if (open) safeLocalStorage()?.setItem(FIRST_RUN_OPEN_KEY, '1');
    else safeLocalStorage()?.removeItem(FIRST_RUN_OPEN_KEY);
  } catch {}
}

export function FirstRunFrame() {
  return (
    <main
      data-testid="first-run-frame"
      aria-busy="true"
      className="flex h-full min-h-0 w-full min-w-0 bg-background"
    >
      <div className="max-lg:hidden lg:max-w-150 lg:basis-2/5 lg:border-r lg:border-border lg:bg-(--surface-1)" />
    </main>
  );
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
  const computersQ = useComputers(teamId, live);
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
    vm:
      computersQ.data?.find(
        (computer) => computer.kind === 'vm' && computer.download?.state === 'absent',
      ) ?? null,
    settings,
    options: toModelOptions(sourcesQ.data?.sources ?? []),
    claudeCodeFound: (sourcesQ.data?.sources ?? []).some(
      (source) => source.runtime === 'claude-code' && source.installed,
    ),
  };
}

type Setup = ReturnType<typeof useFirstRunSetup>;

const NO_HANGS: readonly SpiralHang[] = [];

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
    (connection) => connection.kind === 'subscription' && connection.available !== false,
  );
  const status = hasProvider
    ? t('已添加，Coordinator 能用')
    : subscriptionSaved && !setup.claudeCodeFound
      ? t(
          '订阅已保存，这台电脑装好 Claude\u00a0Code 后会自动用上。现在先添加一个服务商，Coordinator 就能开始工作。',
        )
      : t('Claude 订阅、API key 或本地模型');
  if (hasProvider) {
    return (
      <SettingsCard>
        <SourceRow
          icon={<KeyRound className="size-5" />}
          title={t('服务商')}
          status={status}
          usedBy={t('Coordinator 和任务都能用')}
        />
      </SettingsCard>
    );
  }
  return (
    <>
      {subscriptionSaved && !setup.claudeCodeFound && (
        <p className="m-0 mb-4 text-pretty break-keep text-meta text-content-secondary">{status}</p>
      )}
      <AddProviderFlow
        inline
        testId="first-run-add-provider"
        teamId={setup.teamId}
        live={live}
        view={addView}
        onViewChange={setAddView}
        connectError={connectError}
        onConnectError={setConnectError}
        lead={<LocalProviderImportCard teamId={setup.teamId} live={live} />}
      />
    </>
  );
}

interface Pick {
  use: 'coordinator' | 'session';
  provider: string;
  modelId: string;
  stored: boolean;
}

function pickOf(
  use: Pick['use'],
  rules: readonly RoutingRuleRecord[],
  fallback: { provider: string | null; modelId: string | null } | undefined,
): Pick | null {
  const rule = rules.find((r) => r.use === use);
  if (rule !== undefined) {
    return { use, provider: rule.provider, modelId: rule.modelId, stored: true };
  }
  if (fallback?.provider == null || fallback.modelId == null) return null;
  return { use, provider: fallback.provider, modelId: fallback.modelId, stored: false };
}

function picksOf(setup: Setup): (Pick | null)[] {
  const rules = setup.settings?.rules ?? [];
  return [
    pickOf('coordinator', rules, setup.settings?.coordinatorDefault),
    pickOf('session', rules, setup.settings?.sessionDefault),
  ];
}

function modelName(pick: Pick, options: readonly ModelOption[]): string {
  const row =
    options.find((o) => o.provider === pick.provider && o.modelId === pick.modelId) ??
    options.find((o) => o.modelId === pick.modelId);
  return row?.modelName ?? pick.modelId;
}

function ConfirmBody({ setup }: { setup: Setup }) {
  const { t } = useI18n();
  const { patchRule } = useRoutingSettingsMutations(setup.teamId);
  const { manageComputer } = useApiMutations(setup.teamId);
  const [downloadVm, setDownloadVm] = useState(false);
  const [changed, setChanged] = useState<Partial<Record<Pick['use'], ModelOption>>>({});
  const suggested = picksOf(setup);
  const picks = suggested.map((pick, i): Pick | null => {
    const use: Pick['use'] = i === 0 ? 'coordinator' : 'session';
    const option = changed[use];
    if (option === undefined) return pick;
    return { use, provider: option.provider, modelId: option.modelId, stored: false };
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
    { use: 'coordinator' as const, who: t('Coordinator'), pick: picks[0] },
    { use: 'session' as const, who: t('新任务'), pick: picks[1] },
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
      if (downloadVm && setup.vm !== null)
        manageComputer.mutate({ computerId: setup.vm.id, action: 'install' });
    } catch (error) {
      toastError(t('保存失败，请重试。'), error);
    }
  };
  return (
    <>
      <ul className="m-0 list-none divide-y divide-border border-y border-border p-0">
        {rows.map(({ use, who, pick }, index) => (
          <li
            key={use}
            data-testid={`first-run-pick-${use}`}
            className="flex min-h-13 flex-wrap items-center gap-x-4 py-2"
          >
            <span className="w-28 flex-none font-title text-foreground">{who}</span>
            {pick == null ? (
              <span className="text-meta text-destructive">{t('还没有能用的模型')}</span>
            ) : (
              <span className="min-w-0 truncate text-foreground">
                {modelName(pick, setup.options)}
              </span>
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
                    'h-6 gap-1 rounded-sm border-0 bg-transparent p-0 text-ui text-foreground underline decoration-content-tertiary underline-offset-4 hover:decoration-current data-[size=default]:h-6 dark:bg-transparent dark:hover:bg-transparent pointer-coarse:-my-2.5 pointer-coarse:h-11 pointer-coarse:data-[size=default]:h-11',
                }}
              />
            </span>
          </li>
        ))}
        {setup.vm?.download != null && (
          <li data-testid="first-run-vm" className="flex min-h-13 items-start gap-x-4 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-title text-foreground">
                {t('Linux 虚拟机')}
                <span className="ml-2 font-normal text-meta text-content-tertiary tabular-nums">
                  {formatDownloadBytes(setup.vm.download.totalBytes)}
                </span>
              </span>
              <span className="text-pretty text-meta text-content-tertiary">
                {t('不占用你的鼠标键盘，和你的文件、账号隔开，可以放心装软件')}
              </span>
            </span>
            <ToggleSwitch
              className="mt-0.5 flex-none"
              aria-label={t('Linux 虚拟机')}
              checked={downloadVm}
              onCheckedChange={setDownloadVm}
            />
          </li>
        )}
      </ul>
      <div className="mt-6">
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

function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <SegmentedRadio
      label={t('语言')}
      value={locale}
      onChange={setLocale}
      className="pointer-coarse:h-8"
      optionHandle="dark:data-active:bg-(--sidebar-active) pointer-coarse:h-7 pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-2 pointer-coarse:before:content-['']"
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
    <div className={cn('m-0', className)}>
      <Button
        variant="link"
        data-testid="first-run-skip"
        className="h-auto min-h-6 p-0 text-meta font-normal text-content-tertiary hover:text-foreground pointer-coarse:-my-3 pointer-coarse:py-3"
        onClick={() => {
          skipSetup();
          onSkip();
        }}
      >
        {t('稍后再说')}
      </Button>
    </div>
  );
}

function stateOf(step: SetupStepId, open: SetupStepId): StepState {
  return open === step ? 'now' : step === 'models' ? 'done' : 'open';
}

function Rail({ open }: { open: SetupStepId }) {
  const { t } = useI18n();
  const steps = [
    { n: 1, id: 'models' as const, title: t('接入模型') },
    { n: 2, id: 'confirm' as const, title: t('确认模型') },
  ];
  return (
    <ol className="m-0 mt-10 list-none p-0 max-lg:hidden">
      {steps.map(({ n, id, title }) => {
        const state = stateOf(id, open);
        return (
          <li
            key={id}
            data-testid={`first-run-step-${n}`}
            data-state={state}
            aria-current={state === 'now' ? 'step' : undefined}
            className="flex items-center gap-4 py-2"
          >
            <StepMark n={n} state={state} />
            <span
              className={cn(
                'text-card-title font-title',
                state === 'open' ? 'text-content-secondary' : 'text-foreground',
              )}
            >
              {title}
            </span>
          </li>
        );
      })}
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
                  : 'bg-content-dim',
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
          <Rail open={open} />
          <Segments open={open} />
          <InkSpiral
            hangs={NO_HANGS}
            drawn={open === 'models' ? 1 / 3 : 2 / 3}
            size={150}
            className="mt-6 self-end max-lg:hidden [@media(max-height:700px)]:hidden"
          />
        </div>
        <SkipLine onSkip={onSkip} className="relative max-lg:hidden" />
      </aside>
      <div className="flex flex-1 flex-col px-5 pt-8 pb-[calc(env(safe-area-inset-bottom)+2rem)] lg:items-center lg:overflow-y-auto lg:px-16 lg:pt-28 lg:pb-15">
        <section
          key={open}
          aria-label={open === 'models' ? t('接入模型') : t('确认模型')}
          className="w-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 lg:my-auto lg:max-w-130"
        >
          <h2 className="m-0 voice-response text-page lg:sr-only">
            {open === 'models' ? t('接入模型') : t('确认模型')}
          </h2>
          {open === 'models' ? (
            <div className="mt-5 lg:mt-0">
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

export function setupResumeStep(setup: Setup): SetupStepId | null {
  if (setup.projects !== 0 || setup.progress === undefined) return null;
  return setupOpenStep(setup.progress);
}

export function SetupResumeBanner({ step, onResume }: { step: SetupStepId; onResume: () => void }) {
  const { t } = useI18n();
  const title = step === 'models' ? t('还没接入模型') : t('模型还没确认');
  return (
    <NoticeBanner
      data-testid="first-run-resume"
      aria-label={title}
      tone="waiting"
      icon={KeyRound}
      title={title}
      body={t('设置做完，Coordinator 才能开始对话。')}
      actions={
        <Button size="sm" className="px-3" onClick={onResume}>
          {t('继续设置')}
        </Button>
      }
    />
  );
}
