import {
  claudeLoginNotice,
  MACHINE_RUNTIMES,
  type MachineRuntime,
  PUBLISHED_PACKAGES,
} from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { TriangleAlert } from 'lucide-react';
import { Fragment, type ReactNode, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useApiMutations, useMembers, useModelSources } from '../api/hooks.js';
import { mapTeam, RUNTIME_LABELS, toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { formatClaudeLoginWarning } from '../claude-login-warning.js';
import { QueryBoundary } from '../components/query-state.js';
import {
  SETTINGS_ROW_CLS,
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsDangerZone,
  SettingsRow,
  SettingsSection,
  SettingsSelectTrigger,
} from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Select, SelectContent, SelectItem, SelectValue } from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { FixtureSet, MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { CreateAgentDialog } from '../routes/create-agent-dialog.js';
import { TeamAgentGrid } from '../routes/team-agent-grid.js';
import { CONCURRENCY_SOURCE_LABEL, MachineConcurrencySelect } from './machine-concurrency.js';
import { offlineGuidance } from './machine-offline.js';
import { OnlineStatus } from './parts.js';

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
  pending,
  onToggle,
}: {
  machine: MachineRow;
  runtime: string;
  live: boolean;
  pending: boolean;
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
        disabled={!toggleable || !live || pending}
        title={toggleable && live ? undefined : t('这台机器还不能单独开关 {name}', { name })}
        onCheckedChange={(next) => {
          if (toggleable) onToggle(runtime, next);
        }}
      />
    </div>
  );
}

export function MachineDetailPane({
  machine,
  machines,
  chief,
  fixture,
  search,
}: {
  machine: MachineRow;
  machines: MachineRow[];
  chief: ChiefState;
  fixture: FixtureSet;
  search: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { live, teamId } = useLiveData();
  const machineId = machine.id ?? '';
  const online = machine.online !== false;
  const mutations = useApiMutations(teamId);
  const queryClient = useQueryClient();

  const membersQ = useMembers(teamId, live);
  const agents = live ? mapTeam(membersQ.data ?? []).agents : (fixture.team?.agents ?? []);
  const homeAgents = agents.filter((a) => a.machineId === machineId);
  const modelSourcesQ = useModelSources(teamId, live);
  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);
  const others = machines.filter((m) => m.id !== machineId);

  const [createOpen, setCreateOpen] = useState(false);
  const [evacuateTarget, setEvacuateTarget] = useState<string | null>(null);
  const [evacuating, setEvacuating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const toggleRuntime = (runtime: MachineRuntime, next: boolean) => {
    const current = (machine.enabledRuntimes ?? []).filter(isMachineRuntime);
    const enabledRuntimes = next
      ? [...new Set([...current, runtime])]
      : current.filter((r) => r !== runtime);
    mutations.patchMachine.mutate(
      { id: machineId, body: { enabledRuntimes } },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  };

  const evacuate = async () => {
    if (evacuateTarget === null) return;
    setEvacuating(true);
    try {
      const res = await fetch(`/api/machines/${machineId}/evacuate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetMachineId: evacuateTarget }),
      });
      const body = (await res.json()) as {
        moved?: string[];
        rejected?: { agentId: string; reason: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if ((body.rejected?.length ?? 0) > 0) {
        toastError(
          t('{n} 个 agent 未过校验留在原机', { n: body.rejected?.length ?? 0 }),
          new Error(body.rejected?.map((r) => r.reason).join('；')),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['machines', teamId] });
      void queryClient.invalidateQueries({ queryKey: ['members', teamId] });
      navigate({ pathname, search: withoutMachine(search) });
    } catch (error) {
      toastError(t('整机迁移失败，请重试。'), error);
    } finally {
      setEvacuating(false);
    }
  };

  const remove = async () => {
    setConfirmOpen(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/machines/${machineId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      void queryClient.invalidateQueries({ queryKey: ['machines', teamId] });
      void queryClient.invalidateQueries({ queryKey: ['members', teamId] });
      navigate({ pathname, search: withoutMachine(search) });
    } catch (error) {
      toastError(t('删除机器失败，请重试。'), error);
    } finally {
      setDeleting(false);
    }
  };

  const capabilities = machine.capabilities;
  return (
    <div
      data-testid="machine-detail"
      data-machine-id={machine.id}
      data-kind={machine.kind ?? 'remote'}
      className="flex min-w-0 flex-col gap-6 px-4 py-4 md:px-6"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2
          data-testid="machine-detail-name"
          className="m-0 truncate text-heading font-semibold text-foreground"
        >
          {machine.name}
        </h2>
        <p className="m-0 text-meta text-content-tertiary">
          {machine.kind === 'local' ? t('这台服务所在的机器') : t('远程机器')}
        </p>
      </div>

      <SettingsSection title={t('状态')}>
        <SettingsCard>
          <SettingsRow
            label={t('连接状态')}
            hint={online ? t('已连接，可以接任务') : t('当前没有连接到服务器')}
          >
            <span data-testid="machine-detail-online">
              <OnlineStatus on={online} />
            </span>
          </SettingsRow>
          {offline !== null && (
            <div
              data-testid="machine-recover"
              className="flex flex-col gap-1 settings-flat-block px-4 py-3 text-meta text-content-secondary"
            >
              {offline.lastSeen !== null && (
                <span className="text-content-tertiary">{offline.lastSeen}</span>
              )}
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
          {(chief.host || chief.running || chief.waiting) && (
            <SettingsRow label={t('Coordinator')} hint={t('这台机器在 Coordinator 里的角色')}>
              <span className="flex flex-wrap items-center justify-end gap-x-3 text-meta">
                {chief.host && (
                  <span className="text-content-secondary">{t('Coordinator 主机')}</span>
                )}
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

      <SettingsSection
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
              pending={mutations.patchMachine.isPending}
              onToggle={toggleRuntime}
            />
          ))}
          {capabilities !== undefined && (
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
          )}
        </SettingsCard>
      </SettingsSection>

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

      <SettingsSection title={t('管理')}>
        <SettingsCard>
          <SettingsRow
            label={t('整机迁移')}
            hint={t('把归属这台机器的 agent 一起迁到另一台机器。')}
            className="flex-wrap gap-y-2 py-2.5"
          >
            <Select value={evacuateTarget} onValueChange={(v) => setEvacuateTarget(v as string)}>
              <SettingsSelectTrigger
                aria-label={t('迁移到')}
                className={`machine-evacuate-select ${SETTINGS_SELECT_TRIGGER_CLS}`}
              >
                <SelectValue>
                  {others.find((m) => m.id === evacuateTarget)?.name ?? t('迁移到…')}
                </SelectValue>
              </SettingsSelectTrigger>
              <SelectContent aria-label={t('迁移到')}>
                {others.map((m) => (
                  <SelectItem key={m.id} className="machine-evacuate-row" value={m.id ?? ''}>
                    {m.name}
                    {m.online === false ? `（${t('离线')}）` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className={DIALOG_PRIMARY_BUTTON}
              disabled={evacuateTarget === null || evacuating || homeAgents.length === 0}
              onClick={evacuate}
              data-testid="machine-evacuate-btn"
            >
              {t('整机迁移')}
            </Button>
          </SettingsRow>
        </SettingsCard>
        <SettingsDangerZone
          label={t('删除机器')}
          description={
            homeAgents.length > 0
              ? t('先迁走归属这台机器的 {n} 个 agent 才能删除。', { n: homeAgents.length })
              : t('删除后，这台机器要重新注册才能再接任务。')
          }
          actionLabel={t('删除')}
          disabled={deleting || homeAgents.length > 0}
          onAction={() => setConfirmOpen(true)}
        />
      </SettingsSection>

      <DeleteConfirm
        open={confirmOpen}
        title={t('确定删除这台机器？此操作不可撤销。')}
        summary={machine.name}
        ariaLabel={t('删除机器')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void remove()}
      />
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

function withoutMachine(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('machine');
  const next = params.toString();
  return next === '' ? '' : `?${next}`;
}
