import { claudeLoginNotice, MACHINE_RUNTIMES, type MachineRuntime } from '@cairn/shared';
import { cn } from 'cn';
import { Monitor, Plus as PlusIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApiMutations, useChief, useMachines, useTeams } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { ClaudeMark, GeminiMark, PiMark } from '../components/brand-marks.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { TEAM_NAME } from '../fixtures/fixtures.js';
import type { MachineRow } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, Minus, Plus, Restore } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import { CreateMachineDialog } from './create-machine-dialog.js';
import { OnlineStatus, ResourceList, ResourceRow, RowMeta, RowText, RowTitle } from './parts.js';

export const MACHINES_HREF = '/app/resources/machines';

const RUNTIME_LABELS: Record<MachineRuntime, string> = {
  pi: 'pi',
  'claude-code': 'Claude Code',
  gemini: 'Gemini',
};

const RUNTIME_MARKS: Record<MachineRuntime, typeof PiMark> = {
  pi: PiMark,
  'claude-code': ClaudeMark,
  gemini: GeminiMark,
};

const FALLBACK_RANGE = { min: 1, max: 8 };

export const CONCURRENCY_SOURCE_LABEL = {
  manual: '手动',
  measured: '推荐',
  estimate: '估算',
} as const;

function BasisRow({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-content-tertiary">{label}</span>
      <span className="tabular-nums text-content-secondary">{value}</span>
    </span>
  );
}

function MachineConcurrencySelect({
  machine,
  value,
  onPick,
  onReset,
}: {
  machine: MachineRow;
  value: number;
  onPick: (n: number) => Promise<unknown> | undefined;
  onReset: () => Promise<unknown> | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const range = machine.concurrencyRange ?? FALLBACK_RANGE;
  const outOfRange = value < range.min || value > range.max;
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  const inFlight = useRef(0);
  const current = pendingTarget ?? value;
  const track = (target: number | null, req: Promise<unknown> | undefined) => {
    if (!req) return;
    inFlight.current += 1;
    setPendingTarget(target);
    void req.finally(() => {
      inFlight.current -= 1;
      if (inFlight.current === 0) setPendingTarget(null);
    });
  };
  const send = (n: number) => track(n, onPick(n));
  const [draft, setDraft] = useState(String(current));
  const [dirty, setDirty] = useState(false);
  const skipCommit = useRef(false);
  useEffect(() => {
    if (!dirty) setDraft(String(current));
  }, [current, dirty]);
  const clampTo = (n: number) => Math.min(range.max, Math.max(range.min, n));
  const settle = (n: number) => {
    setDraft(String(n));
    setDirty(false);
  };
  const commit = () => {
    if (!dirty) return;
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      settle(current);
      return;
    }
    const next = clampTo(parsed);
    settle(next);
    if (next !== current) send(next);
  };
  const step = (delta: number) => {
    const parsed = Number.parseInt(draft, 10);
    const base = dirty && !Number.isNaN(parsed) ? parsed : current;
    const next = clampTo(clampTo(base) + delta);
    settle(next);
    if (next !== current) send(next);
  };
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();
  const recommended = machine.recommendedConcurrent;
  const hardware = machine.capabilities?.hardware;
  const source = machine.concurrencySource;
  const estimate = source === 'estimate';
  const overridden = machine.maxConcurrentOverridden === true;
  const label =
    source !== undefined
      ? t('并发上限 {n}，{source}', { n: value, source: t(CONCURRENCY_SOURCE_LABEL[source]) })
      : t('并发上限 {n}', { n: value });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          settle(current);
          skipCommit.current = false;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label={label}
            title={label}
            data-machine-id={machine.id}
            data-testid="machine-concurrency"
            data-concurrency-source={source}
            className="h-6 w-10 cursor-pointer justify-between gap-1 rounded-md px-1.5 text-meta font-normal text-content-tertiary hover:bg-(--surface-hover) active:not-aria-[haspopup]:translate-y-0"
          />
        }
      >
        <span className="tabular-nums">{value}</span>
        <ChevronDown width={11} height={11} className="flex-none" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        aria-label={t('并发上限')}
        className="w-52 p-(--menu-pad)"
      >
        <div className="flex items-baseline justify-between px-1">
          <span className="text-meta text-content-tertiary">{t('并发上限')}</span>
          <span className="text-ui font-medium tabular-nums text-foreground">{value}</span>
        </div>
        {source !== undefined && (
          <div className="px-1 text-meta text-content-tertiary">
            {t(CONCURRENCY_SOURCE_LABEL[source])}
          </div>
        )}
        <div className="flex items-center gap-1 px-1 py-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('减少并发上限')}
            data-testid="machine-concurrency-dec"
            disabled={current <= range.min && Number.parseInt(draft, 10) <= range.min}
            className="size-7 cursor-pointer rounded-md text-content-secondary hover:bg-(--surface-hover)"
            data-concurrency-action="step"
            onMouseDown={keepFocus}
            onClick={() => step(-1)}
          >
            <Minus width={12} height={12} />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            role="spinbutton"
            aria-label={t('并发上限')}
            aria-valuemin={range.min}
            aria-valuemax={range.max}
            aria-valuenow={value}
            aria-describedby={`concurrency-hint-${machine.id}`}
            min={range.min}
            max={range.max}
            data-testid="machine-concurrency-input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                skipCommit.current = true;
                settle(current);
              }
            }}
            onBlur={(e) => {
              const to = e.relatedTarget as HTMLElement | null;
              if (skipCommit.current || to?.dataset.concurrencyAction !== undefined) {
                skipCommit.current = false;
                return;
              }
              commit();
            }}
            className="h-7 flex-1 [appearance:textfield] rounded-md px-1 text-center text-ui tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('增加并发上限')}
            data-testid="machine-concurrency-inc"
            disabled={current >= range.max && Number.parseInt(draft, 10) >= range.max}
            className="size-7 cursor-pointer rounded-md text-content-secondary hover:bg-(--surface-hover)"
            data-concurrency-action="step"
            onMouseDown={keepFocus}
            onClick={() => step(1)}
          >
            <Plus width={12} height={12} />
          </Button>
        </div>
        <div
          id={`concurrency-hint-${machine.id}`}
          data-testid="machine-concurrency-hint"
          className="px-1 pb-1 text-meta text-content-tertiary"
        >
          {t(estimate ? '可选 {min}–{max}（默认档位）' : '可选 {min}–{max}（按内存）', range)}
          {recommended !== undefined && ` · ${t('推荐 {n}', { n: recommended })}`}
          {outOfRange && (
            <span data-testid="machine-concurrency-out-of-range" className="block">
              {t('当前值 {n} 超出可选范围', { n: value })}
            </span>
          )}
        </div>
        {(estimate || hardware?.memoryTotalMb !== undefined) && (
          <div
            className="flex flex-col gap-1 px-1 text-meta"
            data-testid="machine-concurrency-basis"
          >
            {estimate ? (
              <span className="text-content-tertiary">
                {t('未收到能力指纹，按保守默认 {n} 估算', { n: recommended ?? value })}
              </span>
            ) : null}
            {estimate || hardware === undefined || hardware.memoryTotalMb === undefined ? null : (
              <>
                <BasisRow label={t('核数')} value={String(hardware.cpuCores)} />
                <BasisRow
                  label={t('总内存')}
                  value={`${(hardware.memoryTotalMb / 1024).toFixed(1)} GiB`}
                />
                <BasisRow label={t('负载')} value={hardware.loadAvg1.toFixed(2)} />
              </>
            )}
          </div>
        )}
        {overridden && (
          <Button
            variant="ghost"
            data-testid="machine-concurrency-reset"
            data-concurrency-action="reset"
            onMouseDown={keepFocus}
            className="h-7 cursor-pointer justify-start gap-1.5 rounded-md px-1 text-meta font-normal text-content-secondary hover:bg-(--surface-hover) active:not-aria-[haspopup]:translate-y-0"
            onClick={() => {
              setDirty(false);
              setOpen(false);
              track(recommended ?? null, onReset());
            }}
          >
            <Restore width={12} height={12} className="flex-none text-content-tertiary" />
            {t('恢复推荐')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function capabilityFull(
  t: ReturnType<typeof useI18n>['t'],
  caps: { mcpServers: unknown[]; skills: unknown[] } | null,
): string {
  return caps === null
    ? t('能力清单未上报')
    : t('MCP {n} · 本机技能 {m}', { n: caps.mcpServers.length, m: caps.skills.length });
}

export function MachinesPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const machines = live ? mapMachines(machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  const chiefQ = useChief(teamId, live);
  const orchestration = live ? chiefQ.data?.orchestration : undefined;
  const activityOf = (machineId?: string) =>
    orchestration?.activity.find((a) => a.machineId === machineId);
  const chiefState = (
    machine: MachineRow,
  ): { host: boolean; running: boolean; waiting: boolean } =>
    live
      ? {
          host: orchestration?.homeMachineId === machine.id,
          running: (activityOf(machine.id)?.running ?? 0) > 0,
          waiting: (activityOf(machine.id)?.waiting ?? 0) > 0,
        }
      : {
          host: machine.chiefHost === true,
          running: machine.chiefRunning === true,
          waiting: machine.chiefWaiting === true,
        };
  const teamsQ = useTeams(live);
  const teamName = live ? (teamsQ.data?.[0]?.name ?? TEAM_NAME) : TEAM_NAME;
  const [addOpen, setAddOpen] = useState(false);
  const mutations = useApiMutations(teamId);

  const rowKey = (machine: MachineRow): string => machine.id ?? machine.name;

  const [capDraft, setCapDraft] = useState<Record<string, number>>({});
  const capOn = (machine: MachineRow): number =>
    capDraft[rowKey(machine)] ?? machine.maxConcurrent ?? 1;
  const capChain = useRef<Record<string, Promise<unknown>>>({});
  const patchCap = (id: string, maxConcurrent: number | null): Promise<unknown> => {
    const prev = capChain.current[id] ?? Promise.resolve();
    const next = prev.then(() =>
      mutations.patchMachine.mutateAsync({ id, body: { maxConcurrent } }).catch(() => undefined),
    );
    capChain.current[id] = next;
    return next;
  };
  const pickCap = (machine: MachineRow, n: number): Promise<unknown> | undefined => {
    if (!live || machine.id == null) {
      setCapDraft((prev) => ({ ...prev, [rowKey(machine)]: n }));
      return;
    }
    return patchCap(machine.id, n);
  };
  const resetCap = (machine: MachineRow): Promise<unknown> | undefined => {
    if (!live || machine.id == null) {
      setCapDraft((prev) => ({
        ...prev,
        [rowKey(machine)]: machine.recommendedConcurrent ?? machine.maxConcurrent ?? 1,
      }));
      return;
    }
    return patchCap(machine.id, null);
  };
  const capSaveFailed =
    mutations.patchMachine.isError &&
    mutations.patchMachine.variables?.body.maxConcurrent !== undefined;

  return (
    <PageShell
      route={MACHINES_HREF}
      title={t('机器')}
      selected={MACHINES_HREF}
      actions={
        machines.length > 0 && (
          <Button className={TOPBAR_PRIMARY_BUTTON} onClick={() => setAddOpen(true)}>
            <PlusIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
            {t('添加机器')}
          </Button>
        )
      }
      fixture={fixture}
    >
      {capSaveFailed && (
        <p className="mt-0 mb-2 text-meta text-destructive" role="alert">
          {t('保存失败，请重试。')}
        </p>
      )}
      {machines.length === 0 ? (
        <EmptyState
          testId="resource-empty"
          className="mt-6"
          icon={Monitor}
          title={t('尚无机器。')}
          description={t('在要执行任务的机器上运行注册命令，它就会出现在这里。')}
          action={{ label: t('添加机器'), onClick: () => setAddOpen(true) }}
        />
      ) : (
        <ResourceList>
          {machines.map((machine) => {
            const chief = chiefState(machine);
            const notice = claudeLoginNotice(machine.claudeLogin, Date.now());
            const loginWarning =
              notice === null
                ? null
                : notice.kind === 'expired'
                  ? t(
                      '{name} 上的 Claude Code 登录已过期。在该机器上运行 `claude auth login` 重新登录。',
                      { name: machine.name },
                    )
                  : notice.days === null
                    ? t(
                        '{name} 上的 Claude Code 登录将在不到 1 天内过期。在该机器上运行 `claude auth login` 重新登录。',
                        { name: machine.name },
                      )
                    : notice.days === 1
                      ? t(
                          '{name} 上的 Claude Code 登录将在 1 天后过期。在该机器上运行 `claude auth login` 重新登录。',
                          { name: machine.name },
                        )
                      : t(
                          '{name} 上的 Claude Code 登录将在 {days} 天后过期。在该机器上运行 `claude auth login` 重新登录。',
                          { name: machine.name, days: notice.days },
                        );
            return (
              <ResourceRow
                key={rowKey(machine)}
                className="flex-wrap gap-y-2"
                data-machine-id={machine.id}
                data-kind={machine.kind ?? 'remote'}
              >
                <RowText>
                  <RowTitle>
                    <Link to={`${MACHINES_HREF}/${machine.id}?${searchParams.toString()}`}>
                      {t(machine.name)}
                    </Link>
                  </RowTitle>
                  {machine.online !== undefined && <OnlineStatus on={machine.online !== false} />}
                </RowText>
                <span className="ml-auto flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
                  {machine.kind === 'local' ? (
                    <span className="flex items-center gap-4">
                      {MACHINE_RUNTIMES.map((runtime) => {
                        const on = (machine.enabledRuntimes ?? []).includes(runtime);
                        const Mark = RUNTIME_MARKS[runtime];
                        return (
                          <span
                            className="flex items-center"
                            key={runtime}
                            data-runtime={runtime}
                            data-enabled={on}
                            role="img"
                            aria-label={RUNTIME_LABELS[runtime]}
                            title={RUNTIME_LABELS[runtime]}
                          >
                            <Mark
                              className={cn('block flex-none', on ? 'opacity-100' : 'opacity-35')}
                            />
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    machine.pill != null && <RowMeta>{t(machine.pill)}</RowMeta>
                  )}
                  {(chief.host || chief.running || chief.waiting) && (
                    <span className="flex flex-none items-center gap-3">
                      {chief.host && (
                        <span
                          className="text-meta font-medium whitespace-nowrap text-content-secondary"
                          data-orchestration="host"
                        >
                          {t('总管主机')}
                        </span>
                      )}
                      {chief.running && (
                        <span
                          className="inline-flex items-center gap-1.5 text-meta whitespace-nowrap text-running-text before:block before:size-1.5 before:rounded-full before:bg-running before:content-['']"
                          data-orchestration="running"
                        >
                          {t('总管回合进行中')}
                        </span>
                      )}
                      {chief.waiting && (
                        <span
                          className="inline-flex items-center gap-1.5 text-meta whitespace-nowrap text-content-tertiary before:block before:size-1.5 before:rounded-full before:bg-content-dim before:content-['']"
                          data-orchestration="waiting"
                        >
                          {t('总管等待机器')}
                        </span>
                      )}
                    </span>
                  )}
                  {machine.maxConcurrent !== undefined && (
                    <span
                      className="flex flex-none items-center gap-2.5"
                      data-machine-col="concurrency"
                    >
                      {machine.runningSteps !== undefined && (
                        <span
                          className="w-16 text-meta whitespace-nowrap tabular-nums text-content-tertiary"
                          data-machine-running={machine.runningSteps}
                        >
                          {t('执行中 {n}/{cap}', {
                            n: machine.runningSteps,
                            cap: capOn(machine),
                          })}
                        </span>
                      )}
                      <MachineConcurrencySelect
                        machine={machine}
                        value={capOn(machine)}
                        onPick={(n) => pickCap(machine, n)}
                        onReset={() => resetCap(machine)}
                      />
                    </span>
                  )}
                  {machine.capabilities !== undefined && (
                    <span
                      className="w-24 flex-none truncate text-right text-meta whitespace-nowrap text-content-tertiary"
                      data-machine-capabilities={
                        machine.capabilities === null ? 'unreported' : 'reported'
                      }
                      title={capabilityFull(t, machine.capabilities)}
                    >
                      <span className="sr-only">{capabilityFull(t, machine.capabilities)}</span>
                      <span aria-hidden="true">
                        {machine.capabilities === null
                          ? '—'
                          : t('MCP {n} · 技能 {m}', {
                              n: machine.capabilities.mcpServers.length,
                              m: machine.capabilities.skills.length,
                            })}
                      </span>
                    </span>
                  )}
                </span>
                {loginWarning !== null && (
                  <span
                    className="basis-full text-meta"
                    data-testid="claude-login-warning"
                    data-login={notice?.kind === 'expired' ? 'expired' : 'expiring'}
                    role="status"
                  >
                    {loginWarning}
                  </span>
                )}
              </ResourceRow>
            );
          })}
        </ResourceList>
      )}
      <CreateMachineDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teamName={teamName}
        teamId={teamId}
      />
    </PageShell>
  );
}
