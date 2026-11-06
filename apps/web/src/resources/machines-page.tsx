import { claudeLoginNotice } from '@cairn/shared';
import { cn } from 'cn';
import { Monitor, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useChief, useMachines, useTeams } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryGate } from '../components/query-gate.js';
import { SettingsPanel } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { TEAM_NAME } from '../fixtures/fixtures.js';
import type { MachineRow } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { CreateMachineDialog } from './create-machine-dialog.js';
import { type ChiefState, MachineDetailPane } from './machine-detail-pane.js';

export const MACHINES_HREF = '/app/resources/machines';

const CHECKED_TICK_MS = 30_000;

type ItemStatus = { label: string; dot: string };

function itemStatus(machine: MachineRow): ItemStatus {
  if (machine.online === false) {
    return { label: '离线', dot: 'bg-content-dim' };
  }
  const notice = claudeLoginNotice(machine.claudeLogin, Date.now());
  if (notice?.kind === 'expired') {
    return { label: '登录已过期', dot: 'bg-(--card-button)' };
  }
  if (notice?.kind === 'expiring') {
    return { label: '登录将过期', dot: 'bg-(--card-button)' };
  }
  return { label: '在线', dot: 'bg-running' };
}

function useCheckedAgo(updatedAt: number): string {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CHECKED_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return relativeTime(updatedAt, Math.max(now, updatedAt), t);
}

function MachineItem({
  machine,
  href,
  selected,
  host,
}: {
  machine: MachineRow;
  href: string;
  selected: boolean;
  host: boolean;
}) {
  const { t } = useI18n();
  const status = itemStatus(machine);
  return (
    <Link
      to={href}
      replace
      data-testid="machine-item"
      data-machine-id={machine.id}
      data-kind={machine.kind ?? 'remote'}
      aria-current={selected ? 'true' : undefined}
      className="flex min-w-0 flex-col gap-0.5 border-b border-border px-3.5 py-2.5 text-inherit no-underline outline-none transition-colors duration-(--dur-fast) last:border-b-0 hover:bg-menu-hover focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset aria-[current=true]:bg-secondary"
    >
      <span className="truncate text-ui font-medium text-foreground">{machine.name}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-meta">
        <span aria-hidden className={cn('size-1.5 flex-none rounded-full', status.dot)} />
        <span
          data-testid="machine-item-status"
          className="whitespace-nowrap text-content-secondary"
        >
          {t(status.label)}
        </span>
        {host && (
          <>
            <span aria-hidden className="text-content-dim">
              ·
            </span>
            <span data-orchestration="host" className="truncate text-content-tertiary">
              {t('Coordinator 主机')}
            </span>
          </>
        )}
      </span>
    </Link>
  );
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
  const chiefState = (machine: MachineRow): ChiefState =>
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
  const [mountedAt] = useState(() => Date.now());
  const checkedAgo = useCheckedAgo(
    live && machinesQ.dataUpdatedAt > 0 ? machinesQ.dataUpdatedAt : mountedAt,
  );

  const rowKey = (machine: MachineRow): string => machine.id ?? machine.name;
  const wanted = searchParams.get('machine');
  const selected = machines.find((m) => rowKey(m) === wanted) ?? machines[0];
  const hrefFor = (machine: MachineRow): string => {
    const next = new URLSearchParams(searchParams);
    next.set('machine', rowKey(machine));
    return `?${next.toString()}`;
  };

  return (
    <PageShell
      route={MACHINES_HREF}
      title={t('机器')}
      selected={MACHINES_HREF}
      fixture={fixture}
      bleed
    >
      <div
        data-testid="machines-scroll"
        className="flex w-full min-w-0 flex-col gap-3 px-4 py-4 md:px-6"
      >
        <QueryGate query={machinesQ} live={live}>
          {machines.length === 0 || selected === undefined ? (
            <EmptyState
              testId="resource-empty"
              className="mt-6"
              icon={Monitor}
              title={t('尚无机器。')}
              description={t('在要执行任务的机器上运行注册命令，它就会出现在这里。')}
              action={{ label: t('添加机器'), onClick: () => setAddOpen(true) }}
            />
          ) : (
            <>
              <SettingsPanel
                header={
                  <>
                    <div className="flex items-center gap-1">
                      <h2 className="m-0 text-card-title font-semibold text-foreground">
                        {t('已接入的机器')}
                      </h2>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('添加机器')}
                        title={t('添加机器')}
                        onClick={() => setAddOpen(true)}
                      >
                        <Plus aria-hidden strokeWidth={1.75} />
                      </Button>
                    </div>
                    {live ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        data-testid="machines-checked"
                        className="gap-1.5 text-content-tertiary"
                        onClick={() => void machinesQ.refetch()}
                      >
                        <RefreshCw
                          aria-hidden
                          strokeWidth={1.75}
                          className={cn('size-3', machinesQ.isFetching && 'animate-spin')}
                        />
                        {t('已检查 {ago}', { ago: checkedAgo })}
                      </Button>
                    ) : (
                      <span
                        data-testid="machines-checked"
                        className="inline-flex items-center gap-1.5 text-meta text-content-tertiary"
                      >
                        <RefreshCw aria-hidden strokeWidth={1.75} className="size-3" />
                        {t('已检查 {ago}', { ago: checkedAgo })}
                      </span>
                    )}
                  </>
                }
              >
                <div className="flex min-w-0 flex-col @3xl:flex-row">
                  <nav
                    data-testid="machine-list"
                    aria-label={t('已接入的机器')}
                    className="flex w-full flex-none flex-col border-b border-border @3xl:w-64 @3xl:border-r @3xl:border-b-0"
                  >
                    {machines.map((machine) => (
                      <MachineItem
                        key={rowKey(machine)}
                        machine={machine}
                        href={hrefFor(machine)}
                        selected={machine === selected}
                        host={chiefState(machine).host}
                      />
                    ))}
                  </nav>
                  <div className="min-w-0 flex-1">
                    <MachineDetailPane
                      key={rowKey(selected)}
                      machine={selected}
                      machines={machines}
                      chief={chiefState(selected)}
                      fixture={fixture}
                      search={`?${searchParams.toString()}`}
                    />
                  </div>
                </div>
              </SettingsPanel>
            </>
          )}
        </QueryGate>
      </div>
      <CreateMachineDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teamName={teamName}
        teamId={teamId}
      />
    </PageShell>
  );
}
