import {
  type CoordinatorDefault,
  MACHINE_RUNTIMES,
  type RoutingRuleRecord,
  type SessionDefault,
} from '@cairn/shared';
import { cn } from 'cn';
import { Check, KeyRound, Plus, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  useApiMutations,
  useChief,
  useMachines,
  useModelSources,
  useProjects,
  useProviders,
} from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { useModelRouting } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import { Switch } from '../components/ui/switch.js';
import { toastError } from '../components/ui/toaster.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/routing-settings-page.js';
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
        className="grid size-5 flex-none place-items-center rounded-full bg-content-tertiary text-background"
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
  summary?: string;
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
          <span className="ml-auto min-w-0 truncate text-meta text-content-tertiary">
            {summary}
          </span>
        )}
      </div>
      {state === 'now' && children !== undefined && (
        <div className="px-4 pb-4 pl-12 max-[640px]:pl-4">{children}</div>
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
    <div className="flex flex-wrap items-center gap-3 border-b border-border py-3 first:border-t">
      <span className="grid size-7 flex-none place-items-center rounded-lg bg-secondary text-content-secondary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-title text-foreground">{title}</div>
        <div className="text-meta text-content-secondary">{status}</div>
        <div className="text-caption text-content-tertiary">{usedBy}</div>
      </div>
      {action}
    </div>
  );
}

function ModelsBody({ setup, progress }: { setup: Setup; progress: SetupProgress }) {
  const { t } = useI18n();
  const { patchMachine } = useApiMutations(setup.teamId);
  const online = setup.machines.find((machine) => machine.online);
  const login = setup.connections.some(
    (c) => online !== undefined && c.id === `machine:${online.id}` && c.available !== false,
  );
  const ccEnabled = (online?.enabledRuntimes ?? []).includes('claude-code');
  const ccStatus =
    online === undefined ? (
      setup.machines.length === 0 ? (
        <span className="inline-flex items-center gap-2">
          <Spinner className="size-3.5" aria-label={t('启动中')} />
          {t('本机 Runner 正在启动，启动后会检查这台电脑上的 Claude Code')}
        </span>
      ) : (
        t('本机 Runner 没有启动，查不到 Claude Code。退出 Cairn 再打开一次。')
      )
    ) : login ? (
      t('这台电脑上找到了已登录的 Claude Code')
    ) : (
      t('没找到已登录的 Claude Code。在终端运行 claude 登录后，这里会自己更新。')
    );
  const hasProvider = progress.models.coordinator;
  return (
    <>
      <p className="m-0 mb-3 text-content-secondary">
        {t('Coordinator 和任务取模型的地方不同：Claude Code 登录只能给任务用。')}
      </p>
      <SourceRow
        icon={<SquareTerminal className="size-4" />}
        title={t('这台电脑上的 Claude Code')}
        status={ccStatus}
        usedBy={t('只给任务用')}
        action={
          online !== undefined && login ? (
            <span className="flex items-center gap-2 text-meta text-content-secondary">
              {ccEnabled ? t('已启用') : t('启用')}
              <Switch
                checked={ccEnabled}
                aria-label={t('让任务用这台电脑上的 Claude Code')}
                onCheckedChange={(next) =>
                  patchMachine.mutate(
                    {
                      id: online.id,
                      body: {
                        enabledRuntimes: MACHINE_RUNTIMES.filter((runtime) =>
                          runtime === 'claude-code'
                            ? next
                            : (online.enabledRuntimes ?? []).includes(runtime),
                        ),
                      },
                    },
                    { onError: (error) => toastError(t('保存失败，请重试。'), error) },
                  )
                }
              />
            </span>
          ) : undefined
        }
      />
      <SourceRow
        icon={<KeyRound className="size-4" />}
        title={t('服务商')}
        status={hasProvider ? t('已添加，Coordinator 能用') : t('Claude token、API key 或本地模型')}
        usedBy={t('Coordinator 和任务都能用')}
        action={
          hasProvider ? undefined : (
            <Button variant="outline" render={<Link to={settingsHref('providers')} />}>
              <Plus />
              {t('添加服务商')}
            </Button>
          )
        }
      />
      {progress.models.tasks && !progress.models.coordinator && (
        <p className="m-0 mt-3 flex items-start gap-2 text-meta text-content-secondary">
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
  const picks = picksOf(setup, t);
  const rows = [
    { who: t('Coordinator'), what: t('和你对话、拆任务、派活'), pick: picks[0] },
    { who: t('新任务'), what: t('写代码和做调研的 Agent 默认用它'), pick: picks[1] },
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
    } catch (error) {
      toastError(t('保存失败，请重试。'), error);
    }
  };
  return (
    <>
      <p className="m-0 mb-3 text-content-secondary">
        {t('Cairn 按你接入的模型挑了这两个。确认后才会保存，以后可以在设置里改。')}
      </p>
      {rows.map(({ who, what, pick }) => {
        const [model, provider] = pick == null ? [null, null] : modelLabel(pick, setup.options);
        return (
          <div
            key={who}
            data-testid={`first-run-pick-${pick?.use ?? who}`}
            className="flex items-start gap-3 border-b border-border py-3 first:border-t"
          >
            <div className="min-w-0 flex-1">
              <div className="font-title text-foreground">{who}</div>
              <div className="text-meta text-content-tertiary">{what}</div>
              {pick == null ? (
                <div className="mt-2 text-meta text-destructive">{t('还没有能用的模型')}</div>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap items-baseline gap-2">
                    <span className="font-title text-foreground">{model}</span>
                    <span className="text-meta text-content-secondary">{provider}</span>
                  </div>
                  <div className="text-meta text-content-tertiary">{pick.why}</div>
                </>
              )}
            </div>
            <Button variant="ghost" render={<Link to={COORDINATOR_ROUTING_HREF} />}>
              {t('换一个')}
            </Button>
          </div>
        );
      })}
      <div className="mt-4">
        <Button
          data-testid="first-run-confirm"
          disabled={!ready || patchRule.isPending}
          onClick={() => void confirm()}
        >
          {t('确认这两个模型')}
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
  const modelsDone = progress.models.coordinator && progress.models.tasks;
  const stateOf = (step: SetupStepId): 'done' | 'now' | 'open' =>
    open === step ? 'now' : step === 'models' || open === null ? 'done' : 'open';
  return (
    <main
      data-testid="first-run-setup"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background"
    >
      <div className="mx-auto w-full max-w-160 px-6 pt-22 pb-12 max-[640px]:px-4 max-[640px]:pt-21">
        <h1 className="m-0 voice-title text-page text-foreground">{t('先把模型配好')}</h1>
        <p className="m-0 mt-2 mb-6 text-content-secondary">
          {t('Cairn 在这台电脑上跑 Agent，用你自己的模型。下面两步做完，就能建第一个项目。')}
        </p>
        <SettingsCard>
          <Step
            n={1}
            title={t('接入模型')}
            state={stateOf('models')}
            summary={
              modelsDone
                ? t('Coordinator 和任务都有模型')
                : progress.models.tasks
                  ? t('Coordinator 还缺服务商')
                  : undefined
            }
          >
            <ModelsBody setup={setup} progress={progress} />
          </Step>
          <Step n={2} title={t('确认模型')} state={stateOf('confirm')}>
            <ConfirmBody setup={setup} />
          </Step>
        </SettingsCard>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {open === null ? (
            <Button render={<Link to="/app/project/new" />}>
              <Plus />
              {t('新建第一个项目')}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled>
                <Plus />
                {t('新建第一个项目')}
              </Button>
              <span className="text-meta text-content-tertiary">{missingStepCopy(open, t)}</span>
            </>
          )}
        </div>
        {open !== null && (
          <p className="m-0 mt-8 text-meta text-content-tertiary">
            {t('不急的话可以')}{' '}
            <Button
              variant="link"
              className="h-auto p-0 text-meta text-content-secondary"
              onClick={() => {
                skipSetup();
                onSkip();
              }}
            >
              {t('先去看看')}
            </Button>
            {t('，下次打开 Cairn 时这页还在。')}
          </p>
        )}
      </div>
    </main>
  );
}
