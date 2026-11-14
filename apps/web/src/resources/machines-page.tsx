import { claudeLoginNotice } from '@cairn/shared';
import { Monitor, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useChief, useMachines, useTeams } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryBoundary } from '../components/query-state.js';
import { SettingsPanel } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { TEAM_NAME } from '../fixtures/fixtures.js';
import type { MachineRow } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { CreateMachineDialog } from './create-machine-dialog.js';
import type { ChiefState } from './machine-detail-pane.js';
import { MachineRowView, type RowSection, rowStatus } from './machine-row.js';

export const MACHINES_HREF = '/app/resources/machines';

export function MachinesPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const teamName = live ? (teamsQ.data?.[0]?.name ?? t('团队')) : TEAM_NAME;
  const defaultMachineId = live
    ? (teamsQ.data?.[0]?.defaultMachineId ?? null)
    : (machines.find((machine) => machine.isDefault === true)?.id ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const [section, setSection] = useState<RowSection | null>(null);

  const rowKey = (machine: MachineRow): string => machine.id ?? machine.name;
  const expandedKey = searchParams.get('machine');
  const setExpanded = (key: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (key === null) next.delete('machine');
    else next.set('machine', key);
    setSearchParams(next, { replace: true });
  };
  const statusOf = (machine: MachineRow) => {
    const notice = claudeLoginNotice(machine.claudeLogin, Date.now());
    return rowStatus(
      machine,
      machine.online === false
        ? null
        : notice?.kind === 'expired' || notice?.kind === 'expiring'
          ? notice.kind
          : null,
    );
  };

  const noMachines = (
    <EmptyState
      testId="resource-empty"
      className="mt-6"
      icon={Monitor}
      title={t('尚无机器')}
      description={t('在要执行任务的机器上运行注册命令，它就会出现在这里。')}
      action={{ label: t('添加机器'), onClick: () => setAddOpen(true) }}
    />
  );
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
        <QueryBoundary
          query={live ? machinesQ : undefined}
          isEmpty={machines.length === 0}
          loadingLabel={t('正在加载机器')}
          errorTitle={t('机器没能加载')}
          className="mt-6"
          empty={noMachines}
        >
          <SettingsPanel
            header={
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
            }
          >
            <div data-testid="machine-list" className="flex min-w-0 flex-col">
              {machines.map((machine) => (
                <MachineRowView
                  key={rowKey(machine)}
                  machine={machine}
                  machines={machines}
                  isDefault={machine.id != null && machine.id === defaultMachineId}
                  chief={chiefState(machine)}
                  status={statusOf(machine)}
                  expanded={expandedKey === rowKey(machine)}
                  section={expandedKey === rowKey(machine) ? section : null}
                  onToggle={() => {
                    setSection(null);
                    setExpanded(expandedKey === rowKey(machine) ? null : rowKey(machine));
                  }}
                  onOpenSection={(next) => {
                    setSection(next);
                    setExpanded(rowKey(machine));
                  }}
                  onClosed={() => setExpanded(null)}
                />
              ))}
            </div>
          </SettingsPanel>
        </QueryBoundary>
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
