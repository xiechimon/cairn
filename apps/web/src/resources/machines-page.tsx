import { Monitor, Plus } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMachines, useTeams } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryBoundary } from '../components/query-state.js';
import { SettingsPanel } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { TEAM_NAME } from '../fixtures/core.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { CreateMachineDialog } from './create-machine-dialog.js';
import { DesktopHostPanel } from './desktop-host-panel.js';
import { MACHINES_HREF } from './hrefs.js';
import { orderMachines } from './machine-order.js';
import { MachineRowView } from './machine-row.js';
import { MachinePhoneRows, PhonePairDialog } from './phones-panel.js';

export function MachinesPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const rawMachines = live
    ? mapMachines(machinesQ.data ?? [])
    : (fixture.resources?.machines ?? []);
  const teamsQ = useTeams(live);
  const teamName = live ? (teamsQ.data?.[0]?.name ?? t('团队')) : TEAM_NAME;
  const defaultMachineId = live
    ? (teamsQ.data?.[0]?.defaultMachineId ?? null)
    : (rawMachines.find((machine) => machine.isDefault === true)?.id ?? null);
  const machines = orderMachines(rawMachines, defaultMachineId);
  const [addOpen, setAddOpen] = useState(false);
  const [pairTarget, setPairTarget] = useState<{
    machineId: string;
    machineName: string;
    phoneId: string | null;
    endpoint: string;
    name: string;
  } | null>(null);
  const targetMachineId = searchParams.get('machine');
  useEffect(() => {
    if (targetMachineId === null || targetMachineId === '') return;
    const node = document.querySelector<HTMLElement>(
      `[data-machine-id="${CSS.escape(targetMachineId)}"]`,
    );
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [targetMachineId, machines.length]);
  const isHostablePhoneHost = (machine: (typeof machines)[number]) =>
    machine.id != null &&
    machine.kind === 'local' &&
    machine.online !== false &&
    machine.capabilities?.osPlatform === 'darwin';
  const hostablePhones = machines.filter(isHostablePhoneHost);
  const phoneHost = hostablePhones.length === 1 ? (hostablePhones[0] ?? null) : null;

  const noMachines = (
    <EmptyState
      testId="resource-empty"
      className="mt-6"
      icon={Monitor}
      title={t('尚无执行机')}
      action={{ label: t('添加执行机'), onClick: () => setAddOpen(true) }}
    />
  );
  return (
    <PageShell
      route={MACHINES_HREF}
      title={t('执行机')}
      selected={MACHINES_HREF}
      fixture={fixture}
      bleed
    >
      <div
        data-testid="machines-scroll"
        className="flex w-full min-w-0 flex-col gap-3 px-4 pt-1 pb-6"
      >
        <QueryBoundary
          query={live ? machinesQ : undefined}
          isEmpty={machines.length === 0}
          loadingLabel={t('正在加载执行机')}
          errorTitle={t('执行机未能加载')}
          className="mt-6"
          empty={noMachines}
        >
          <SettingsPanel
            header={
              <div className="flex w-full items-center justify-between gap-3">
                <h2 className="m-0 text-heading font-title text-foreground">
                  {t('已接入的执行机')}
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="pointer-coarse:h-11"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus aria-hidden strokeWidth={1.75} />
                  {t('添加执行机')}
                </Button>
              </div>
            }
          >
            <div data-testid="machine-list" className="flex min-w-0 flex-col">
              {machines.map((machine) => {
                const machineId = machine.id ?? '';
                const machineName = machine.name ?? machineId;
                const hostable = isHostablePhoneHost(machine);
                return (
                  <Fragment key={machine.id ?? machine.name}>
                    <MachineRowView
                      machine={machine}
                      machines={machines}
                      isDefault={machine.id != null && machine.id === defaultMachineId}
                      highlighted={machine.id != null && machine.id === targetMachineId}
                      onPairPhone={
                        hostable
                          ? () =>
                              setPairTarget({
                                machineId,
                                machineName,
                                phoneId: null,
                                endpoint: '',
                                name: '',
                              })
                          : undefined
                      }
                    />
                    <MachinePhoneRows
                      machine={machine}
                      onOpenPair={(target) =>
                        setPairTarget({
                          machineId,
                          machineName,
                          ...target,
                        })
                      }
                    />
                  </Fragment>
                );
              })}
            </div>
          </SettingsPanel>
        </QueryBoundary>
        <DesktopHostPanel />
      </div>
      <CreateMachineDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        teamName={teamName}
        teamId={teamId}
        phoneHost={
          phoneHost === null
            ? null
            : { id: phoneHost.id ?? '', name: phoneHost.name ?? phoneHost.id ?? '' }
        }
      />
      {pairTarget !== null && (
        <PhonePairDialog
          open
          key={`${pairTarget.machineId}:${pairTarget.phoneId ?? ''}:${pairTarget.endpoint}`}
          machineId={pairTarget.machineId}
          machineName={pairTarget.machineName}
          phoneId={pairTarget.phoneId}
          prefillEndpoint={pairTarget.endpoint}
          prefillName={pairTarget.name}
          onClose={() => setPairTarget(null)}
        />
      )}
    </PageShell>
  );
}
