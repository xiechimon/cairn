import type { CoordinatorDefault, RoutingRuleRecord, SessionDefault } from '@cairn/shared';
import { cn } from 'cn';
import { Check, KeyRound, Plus, SquareTerminal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useChief, useMachines, useModelSources, useProjects, useProviders } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { useModelRouting } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError } from '../components/ui/toaster.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ModelPicker } from '../resources/routing-settings-page.js';
import { safeSessionStorage } from '../safe-storage.js';
import { settingsHref } from '../settings/settings-href.js';
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
  };
}

type Setup = ReturnType<typeof useFirstRunSetup>;

export function missingStepCopy(step: SetupStepId, t: TFunc): string {
  return step === 'models' ? t('还差第 1 步：接入模型') : t('还差第 2 步：确认模型');
}

function StepGlyph({ n, state }: { n: number; state: 'done' | 'now' | 'open' }) {
  const { t } = useI18n();
  if (state === 'done') {
    return (
      <span
        role="img"
        aria-label={t('已完成')}
        className="grid size-5 flex-none place-items-center rounded-full bg-foreground text-background"
      >
        <Check className="size-4" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-5 flex-none place-items-center rounded-full font-mono text-caption',
        state === 'now'
          ? 'border border-foreground text-foreground'
          : 'border border-dashed border-content-dim text-content-tertiary',
      )}
    >
      {n}
    </span>
  );
}

function Step({
  n,
  title,
  state,
  summary,
  children,
}: {
  n: number;
  title: string;
  state: 'done' | 'now' | 'open';
  summary?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section data-testid={`first-run-step-${n}`} data-state={state} aria-label={title}>
      <div className="flex min-h-13 items-center gap-3 px-4 py-2">
        <StepGlyph n={n} state={state} />
        <span
          className={cn(
            'text-card-title font-title',
            state === 'open' ? 'text-content-secondary' : 'text-foreground',
          )}
        >
          {title}
        </span>
        {summary !== undefined && (
          <span className="ml-auto min-w-0 truncate text-right text-meta text-content-tertiary max-[640px]:whitespace-normal">
            {summary}
          </span>
        )}
      </div>
      {state === 'now' && children !== undefined && (
        <div className="px-4 pt-1 pb-4 pl-12 max-[640px]:pl-4">{children}</div>
      )}
    </section>
  );
}

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
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
      <span className="grid size-8 flex-none place-items-center rounded-lg bg-background text-content-secondary ring-1 ring-border">
        {icon}
      </span>
      <div className="min-w-48 flex-1 text-pretty">
        <div className="text-foreground">
          <span className="font-title">{title}</span>
          <span className="text-meta whitespace-nowrap text-content-tertiary"> · {usedBy}</span>
        </div>
        <div className="text-meta text-content-secondary">{status}</div>
      </div>
      {action}
    </div>
  );
}

function ModelsBody({ setup, progress }: { setup: Setup; progress: SetupProgress }) {
  const { t } = useI18n();
  const online = setup.machines.find((machine) => machine.online);
  const login = setup.connections.some(
    (c) => online !== undefined && c.id === `machine:${online.id}` && c.available !== false,
  );
  const desktop = 'cairnDesktop' in window;
  const ccStatus =
    online === undefined ? (
      !desktop ? (
        withCodeSpans(
          t('还没有在线的执行机。在要跑任务的电脑上装好 CLI，运行 `cairn start` 并批准它。'),
        )
      ) : setup.machines.length === 0 ? (
        <span className="inline-flex items-center gap-2">
          <Spinner className="size-3.5" aria-label={t('启动中')} />
          {t('本机执行机正在启动，启动后会检查这台电脑上的 Claude Code')}
        </span>
      ) : (
        t('本机执行机没有启动，查不到 Claude Code。退出 Cairn 再打开一次。')
      )
    ) : login ? (
      t('已在这台电脑上登录')
    ) : (online.enabledRuntimes ?? []).includes('claude-code') ? (
      withCodeSpans(t('没找到已登录的 Claude Code。在终端运行 `claude` 登录后，这里会自己更新。'))
    ) : (
      withCodeSpans(
        t('{machine} 上没有检测到 Claude Code。装好后运行 `cairn restart`，这里会自己更新。', {
          machine: online.name,
        }),
      )
    );
  const hasProvider = progress.models.coordinator;
  return (
    <>
      <div className="divide-y divide-border">
        <SourceRow
          icon={<SquareTerminal className="size-5" />}
          title={t('本机 Claude Code')}
          status={ccStatus}
          usedBy={t('只给任务用')}
          action={
            online === undefined && !desktop ? (
              <div className="flex min-h-8 items-center max-[640px]:w-full max-[640px]:pl-11">
                <Button
                  variant="secondary"
                  className="pointer-coarse:h-11"
                  render={<Link to={settingsHref('machines')} />}
                >
                  <Plus />
                  {t('添加执行机')}
                </Button>
              </div>
            ) : undefined
          }
        />
        <SourceRow
          icon={<KeyRound className="size-5" />}
          title={t('服务商')}
          status={
            hasProvider ? t('已添加，Coordinator 能用') : t('Claude 订阅、API key 或本地模型')
          }
          usedBy={t('Coordinator 和任务都能用')}
          action={
            hasProvider ? undefined : (
              <div className="flex min-h-8 items-center max-[640px]:w-full max-[640px]:pl-11">
                <Button
                  className="pointer-coarse:h-11"
                  render={<Link to={settingsHref('providers')} />}
                >
                  <Plus />
                  {t('添加服务商')}
                </Button>
              </div>
            )
          }
        />
      </div>
      {progress.models.tasks && !progress.models.coordinator && (
        <p className="m-0 mt-1 flex items-start gap-2 text-pretty text-meta text-content-secondary">
          <span className="mt-1.5 size-1.5 flex-none rounded-full bg-(--card-button)" />
          {t('任务已经能跑了。Coordinator 用不了 Claude Code 登录，还需要一个服务商。')}
        </p>
      )}
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
      <p className="m-0 mb-3 text-content-secondary">
        {t('Cairn 按你接入的模型挑了这两个。确认后才会保存，以后可以在设置里改。')}
      </p>
      <div className="divide-y divide-border">
        {rows.map(({ use, who, what, pick }, index) => {
          const [model, provider] = pick == null ? [null, null] : modelLabel(pick, setup.options);
          return (
            <div key={who} data-testid={`first-run-pick-${use}`} className="py-3">
              <div className="text-pretty">
                <span className="text-foreground">{who}</span>
                <span className="text-meta text-content-tertiary"> · {what}</span>
              </div>
              <div className="mt-1 flex min-h-6 flex-wrap items-center gap-x-2">
                {pick == null ? (
                  <span className="text-meta text-destructive">{t('还没有能用的模型')}</span>
                ) : (
                  <>
                    <span className="font-title text-foreground">{model}</span>
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
                <div className="text-pretty text-meta text-content-tertiary">{pick.why}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <Button
          data-testid="first-run-confirm"
          className="pointer-coarse:h-11"
          disabled={!ready || patchRule.isPending}
          onClick={() => void confirm()}
        >
          {patchRule.isPending && <Spinner className="size-4" />}
          {patchRule.isPending ? t('保存中…') : t('确认这两个模型')}
        </Button>
      </div>
    </>
  );
}

export function FirstRunSetup({ setup, onSkip }: { setup: Setup; onSkip: () => void }) {
  const { t } = useI18n();
  const progress = setup.progress;
  if (progress === undefined) return null;
  const open = setupOpenStep(progress);
  const stateOf = (step: SetupStepId): 'done' | 'now' | 'open' =>
    open === step ? 'now' : step === 'models' || open === null ? 'done' : 'open';
  const saved =
    open === null
      ? picksOf(setup, t).flatMap((pick, i) =>
          pick == null
            ? []
            : [
                i > 0 && (
                  <span key="sep" className="max-[640px]:hidden">
                    {' · '}
                  </span>
                ),
                <span key={pick.use} className="max-[640px]:block">
                  {t('{role}：{model}', {
                    role: pick.use === 'coordinator' ? t('Coordinator') : t('任务'),
                    model: modelLabel(pick, setup.options)[0],
                  })}
                </span>,
              ],
        )
      : undefined;
  return (
    <main
      data-testid="first-run-setup"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background"
    >
      <div className="mx-auto w-full max-w-160 px-6 pt-22 pb-12 max-[640px]:px-4 max-[640px]:pt-21">
        <h1 className="m-0 voice-title text-page text-foreground">
          {open === null ? t('模型配好了') : t('先把模型配好')}
        </h1>
        <p className="m-0 mt-2 mb-6 text-pretty text-content-secondary">
          {open === null
            ? t('现在可以建第一个项目了。模型以后可以在设置里改。')
            : t('Cairn 在这台电脑上跑 Agent，用你自己的模型。做完下面两步就能建第一个项目。')}
        </p>
        <SettingsCard>
          <Step
            n={1}
            title={t('接入模型')}
            state={stateOf('models')}
            summary={open === 'models' ? undefined : t('Coordinator 和任务都有模型')}
          >
            <ModelsBody setup={setup} progress={progress} />
          </Step>
          <Step n={2} title={t('确认模型')} state={stateOf('confirm')} summary={saved}>
            <ConfirmBody setup={setup} />
          </Step>
        </SettingsCard>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {open === null ? (
            <Button className="pointer-coarse:h-11" render={<Link to="/app/project/new" />}>
              <Plus />
              {t('新建第一个项目')}
            </Button>
          ) : (
            <>
              <Button className="pointer-coarse:h-11" disabled>
                <Plus />
                {t('新建第一个项目')}
              </Button>
              <span className="text-meta text-content-tertiary">{missingStepCopy(open, t)}</span>
            </>
          )}
        </div>
        {open !== null && (
          <p className="m-0 mt-6 text-pretty text-meta text-content-tertiary">
            {t('不急的话可以')}
            <Button
              variant="link"
              className="inline-flex h-auto min-h-6 p-0 align-baseline text-meta text-foreground underline decoration-content-tertiary underline-offset-4 pointer-coarse:-my-3 pointer-coarse:py-3"
              onClick={() => {
                skipSetup();
                onSkip();
              }}
            >
              {t('先跳过，去主页看看')}
            </Button>
            {t('，下次打开 Cairn 时这页还在。')}
          </p>
        )}
      </div>
    </main>
  );
}
