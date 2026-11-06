import {
  claudeLoginNotice,
  MACHINE_RUNTIMES,
  type MachineRuntime,
  PUBLISHED_PACKAGES,
} from '@cairn/shared';
import { cn } from 'cn';
import { TriangleAlert } from 'lucide-react';
import { Fragment, type ReactNode, useRef, useState } from 'react';
import { useApiMutations, useMembers, useModelSources } from '../api/hooks.js';
import { mapTeam, RUNTIME_LABELS, toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { formatClaudeLoginWarning } from '../claude-login-warning.js';
import { QueryBoundary } from '../components/query-state.js';
import {
  SETTINGS_ROW_CLS,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { FixtureSet, MachineRow, TeamAgentCard } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { CreateAgentDialog } from '../routes/create-agent-dialog.js';
import { TeamAgentGrid } from '../routes/team-agent-grid.js';
import { CONCURRENCY_SOURCE_LABEL, MachineConcurrencySelect } from './machine-concurrency.js';
import { offlineGuidance } from './machine-offline.js';

export interface ChiefState {
  host: boolean;
  running: boolean;
  waiting: boolean;
}

const RUNTIME_NAMES: Record<string, string> = {
  ...RUNTIME_LABELS,
  codex: 'Codex',
  gemini: 'Gemini',
};

const LOGIN_STATE = {
  'logged-in': { label: '已登录', dot: 'bg-running', text: 'text-running-text' },
  'logged-out': { label: '未登录', dot: 'bg-(--card-button)', text: 'text-content-secondary' },
  unknown: { label: '状态未知', dot: 'bg-content-dim', text: 'text-content-tertiary' },
} as const;

const isMachineRuntime = (value: string): value is MachineRuntime =>
  (MACHINE_RUNTIMES as readonly string[]).includes(value);

const FALLBACK_CAP = 1;

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-code text-foreground">
      {children}
    </code>
  );
}

export function TextWithCode({ text }: { text: string }) {
  let offset = 0;
  return (
    <>
      {text.split('`').map((part, order) => {
        const key = offset;
        offset += part.length + 1;
        return order % 2 === 1 ? (
          <InlineCode key={key}>{part}</InlineCode>
        ) : (
          <Fragment key={key}>{part}</Fragment>
        );
      })}
    </>
  );
}

function RuntimeRow({
  machine,
  runtime,
  live,
  frozen,
  onToggle,
}: {
  machine: MachineRow;
  runtime: string;
  live: boolean;
  frozen: boolean;
  onToggle: (runtime: MachineRuntime, next: boolean) => void;
}) {
  const { t } = useI18n();
  const provider = machine.providers?.find((p) => p.runtime === runtime);
  const toggleable = isMachineRuntime(runtime);
  const enabled = toggleable
    ? (machine.enabledRuntimes ?? []).includes(runtime)
    : (provider?.enabled ?? false);
  const name = RUNTIME_NAMES[runtime] ?? runtime;
  const meta =
    provider === undefined
      ? []
      : [provider.plan, provider.version].filter((part): part is string => part !== null);
  const login = provider === undefined ? null : LOGIN_STATE[provider.login];
  return (
    <div
      data-testid="provider-row"
      data-runtime={runtime}
      data-login={provider?.login}
      data-enabled={enabled}
      className={cn(SETTINGS_ROW_CLS, 'flex-wrap gap-y-1')}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-ui text-foreground">{name}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-meta text-content-tertiary">
          {meta.length > 0 && <span className="font-mono">{meta.join(' · ')}</span>}
          {login !== null && (
            <span className={cn('inline-flex items-center gap-1.5', login.text)}>
              <span aria-hidden className={cn('size-1.5 flex-none rounded-full', login.dot)} />
              {t(login.label)}
            </span>
          )}
          {provider?.login === 'logged-out' && provider.loginCommand !== null && (
            <span>
              {t('在这台机器上运行')}{' '}
              <span data-testid="provider-login-command">
                <InlineCode>{provider.loginCommand}</InlineCode>
              </span>
            </span>
          )}
          {provider === undefined && <span>{enabled ? t('接任务中') : t('未开启')}</span>}
        </span>
      </span>
      <ToggleSwitch
        data-testid="provider-toggle"
        aria-label={t('{name} 接任务', { name })}
        checked={enabled}
        disabled={!toggleable || !live || frozen}
        title={toggleable && live ? undefined : t('这台机器还不能单独开关 {name}', { name })}
        onCheckedChange={(next) => {
          if (toggleable) onToggle(runtime, next);
        }}
      />
    </div>
  );
}

export function useHomeAgents(machine: MachineRow, fixture: FixtureSet) {
  const { live, teamId } = useLiveData();
  const membersQ = useMembers(teamId, live);
  const agents = live ? mapTeam(membersQ.data ?? []).agents : (fixture.team?.agents ?? []);
  return { membersQ, homeAgents: agents.filter((a) => a.machineId === (machine.id ?? '')) };
}

export function MachineDetailPane({
  machine,
  machines,
  chief,
  fixture,
  search,
  pending,
  onToggleRuntime,
  membersQ,
  homeAgents,
}: {
  machine: MachineRow;
  machines: MachineRow[];
  chief: ChiefState;
  fixture: FixtureSet;
  search: string;
  pending: boolean;
  onToggleRuntime: (runtime: MachineRuntime, next: boolean) => void;
  membersQ: ReturnType<typeof useMembers>;
  homeAgents: TeamAgentCard[];
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const machineId = machine.id ?? '';
  const online = machine.online !== false;
  const mutations = useApiMutations(teamId);

  const modelSourcesQ = useModelSources(teamId, live);
  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);

  const [createOpen, setCreateOpen] = useState(false);

  const [capDraft, setCapDraft] = useState<number | null>(null);
  const capOn = capDraft ?? machine.maxConcurrent ?? FALLBACK_CAP;
  const capChain = useRef<Promise<unknown>>(Promise.resolve());
  const patchCap = (maxConcurrent: number | null): Promise<unknown> => {
    const next = capChain.current.then(() =>
      mutations.patchMachine
        .mutateAsync({ id: machineId, body: { maxConcurrent } })
        .catch(() => undefined),
    );
    capChain.current = next;
    return next;
  };
  const pickCap = (n: number): Promise<unknown> | undefined => {
    if (!live || machine.id == null) {
      if (blockDemoWrite()) return;
      setCapDraft(n);
      return;
    }
    return patchCap(n);
  };
  const resetCap = (): Promise<unknown> | undefined => {
    if (!live || machine.id == null) {
      if (blockDemoWrite()) return;
      setCapDraft(machine.recommendedConcurrent ?? machine.maxConcurrent ?? FALLBACK_CAP);
      return;
    }
    return patchCap(null);
  };
  const capSaveFailed =
    mutations.patchMachine.isError &&
    mutations.patchMachine.variables?.body.maxConcurrent !== undefined;

  const offline = online
    ? null
    : offlineGuidance(
        { online: false, lastSeenAt: machine.lastSeenAt },
        Date.now(),
        `${PUBLISHED_PACKAGES.cli.command} start`,
        t,
      );
  const notice = claudeLoginNotice(machine.claudeLogin, Date.now());
  const loginWarning = notice === null ? null : formatClaudeLoginWarning(notice, machine.name, t);

  const runtimes: string[] = [
    ...MACHINE_RUNTIMES,
    ...(machine.providers ?? [])
      .map((p) => p.runtime as string)
      .filter((runtime) => !isMachineRuntime(runtime)),
  ];

  const capabilities = machine.capabilities;
  return (
    <div
      data-testid="machine-detail"
      data-machine-id={machine.id}
      data-kind={machine.kind ?? 'remote'}
      className="flex min-w-0 flex-col gap-6 border-t border-border px-4 py-4"
    >
      {!online && (
        <p data-testid="machine-offline-hint" className="m-0 text-meta text-content-tertiary">
          {t('重新连接 {name} 后才能修改它的设置。', { name: machine.name })}
        </p>
      )}
      {(offline !== null || loginWarning !== null || chief.running || chief.waiting) && (
        <SettingsSection title={t('状态')}>
          <SettingsCard>
            {offline !== null && (
              <div
                data-testid="machine-recover"
                className="flex flex-col gap-1 settings-flat-block px-4 py-3 text-meta text-content-secondary"
              >
                <span>
                  <TextWithCode text={offline.recovery} />
                </span>
              </div>
            )}
            {loginWarning !== null && (
              <div
                data-testid="claude-login-warning"
                data-login={notice?.kind === 'expired' ? 'expired' : 'expiring'}
                role="status"
                className="flex items-start gap-2 settings-flat-block px-4 py-3 text-meta text-content-secondary"
              >
                <TriangleAlert
                  aria-hidden
                  strokeWidth={1.75}
                  className="mt-0.5 size-3.5 flex-none text-content-secondary"
                />
                <span>
                  <TextWithCode text={loginWarning} />
                </span>
              </div>
            )}
            {(chief.running || chief.waiting) && (
              <SettingsRow label={t('Coordinator')} hint={t('这台机器在 Coordinator 里的角色')}>
                <span className="flex flex-wrap items-center justify-end gap-x-3 text-meta">
                  {chief.running && (
                    <span
                      className="inline-flex items-center gap-1.5 text-running-text before:block before:size-1.5 before:rounded-full before:bg-running before:content-['']"
                      data-orchestration="running"
                    >
                      {t('Coordinator 回合进行中')}
                    </span>
                  )}
                  {chief.waiting && (
                    <span
                      className="inline-flex items-center gap-1.5 text-content-tertiary before:block before:size-1.5 before:rounded-full before:bg-content-dim before:content-['']"
                      data-orchestration="waiting"
                    >
                      {t('Coordinator 等待机器')}
                    </span>
                  )}
                </span>
              </SettingsRow>
            )}
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection
        testId="machine-runtimes"
        title={t('运行时')}
        description={t('这台机器上能接任务的执行器，以及它们的登录状态。')}
      >
        <SettingsCard>
          {runtimes.map((runtime) => (
            <RuntimeRow
              key={runtime}
              machine={machine}
              runtime={runtime}
              live={live}
              frozen={pending || !online}
              onToggle={onToggleRuntime}
            />
          ))}
        </SettingsCard>
      </SettingsSection>

      {capabilities !== undefined && (
        <SettingsSection testId="machine-capabilities" title={t('能力')}>
          <SettingsCard>
            <SettingsRow label={t('能力')} hint={t('这台机器上报的 MCP 与技能清单')}>
              <span
                className="text-meta text-content-secondary"
                data-machine-capabilities={capabilities === null ? 'unreported' : 'reported'}
              >
                {capabilities === null
                  ? t('能力清单未上报')
                  : t('MCP {n} · 本机技能 {m}', {
                      n: capabilities.mcpServers.length,
                      m: capabilities.skills.length,
                    })}
              </span>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}

      {machine.maxConcurrent !== undefined && (
        <SettingsSection title={t('容量')}>
          <SettingsCard>
            <SettingsRow
              label={t('并发上限')}
              labelTestId="machine-capacity-label"
              hint={
                <span data-machine-col="concurrency">
                  {machine.runningSteps !== undefined && (
                    <span data-testid="machine-running" data-machine-running={machine.runningSteps}>
                      {t('执行中 {n}/{cap}', { n: machine.runningSteps, cap: capOn })}
                    </span>
                  )}
                  {machine.concurrencySource !== undefined && (
                    <span data-concurrency-source={machine.concurrencySource}>
                      {machine.runningSteps !== undefined ? ' · ' : ''}
                      {t(CONCURRENCY_SOURCE_LABEL[machine.concurrencySource])}
                    </span>
                  )}
                </span>
              }
            >
              <MachineConcurrencySelect
                machine={machine}
                value={capOn}
                onPick={pickCap}
                onReset={resetCap}
                disabled={!online}
              />
            </SettingsRow>
          </SettingsCard>
          {capSaveFailed && (
            <p className="m-0 px-1 text-meta text-destructive" role="alert">
              {t('保存失败，请重试。')}
            </p>
          )}
        </SettingsSection>
      )}

      <SettingsSection title={t('归属的 Agent')}>
        <QueryBoundary
          query={live ? membersQ : undefined}
          isEmpty={live && membersQ.data === undefined}
          loadingLabel={t('正在加载团队')}
          errorTitle={t('团队没能加载')}
          empty={null}
        >
          <TeamAgentGrid
            rows
            agents={homeAgents}
            machines={machines}
            onCreate={() => setCreateOpen(true)}
            search={search}
          />
        </QueryBoundary>
      </SettingsSection>

      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        modelOptions={modelOptions}
        machines={machines}
        defaultMachineId={machineId}
        onCreate={
          live
            ? (input) =>
                mutations.createAgent.mutate(input, {
                  onSuccess: () => setCreateOpen(false),
                  onError: (error) => toastError(t('创建 Agent 失败，请重试。'), error),
                })
            : undefined
        }
      />
    </div>
  );
}
