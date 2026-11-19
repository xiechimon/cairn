import { Monitor, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useMachines, useTeams } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryBoundary } from '../components/query-state.js';
import { SettingsCard, SettingsPanel, SettingsRow } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { TEAM_NAME } from '../fixtures/core.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { CreateMachineDialog } from './create-machine-dialog.js';
import { MACHINES_HREF } from './hrefs.js';
import { MachineRowView } from './machine-row.js';

export function MachinesPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const machines = live ? mapMachines(machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  const teamsQ = useTeams(live);
  const teamName = live ? (teamsQ.data?.[0]?.name ?? t('团队')) : TEAM_NAME;
  const defaultMachineId = live
    ? (teamsQ.data?.[0]?.defaultMachineId ?? null)
    : (machines.find((machine) => machine.isDefault === true)?.id ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const mutations = useApiMutations(teamId);
  const [fixtureOwnConfig, setFixtureOwnConfig] = useState(false);
  const ownAgentConfig = live ? teamsQ.data?.[0]?.ownAgentConfig === true : fixtureOwnConfig;
  const commitOwnAgentConfig = (next: boolean) => {
    if (!live) {
      if (blockDemoWrite()) return;
      setFixtureOwnConfig(next);
      return;
    }
    mutations.patchTeamAgentConfig.mutate(
      { ownAgentConfig: next },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  };

  const noMachines = (
    <EmptyState
      testId="resource-empty"
      className="mt-6"
      icon={Monitor}
      title={t('尚无执行机')}
      description={t('在要执行任务的执行机上运行注册命令，它就会出现在这里。')}
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
          errorTitle={t('执行机没能加载')}
          className="mt-6"
          empty={noMachines}
        >
          <SettingsPanel
            header={
              <div className="flex w-full items-center justify-between gap-3">
                <h2 className="m-0 text-card-title font-semibold text-foreground">
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
              {machines.map((machine) => (
                <MachineRowView
                  key={machine.id ?? machine.name}
                  machine={machine}
                  machines={machines}
                  isDefault={machine.id != null && machine.id === defaultMachineId}
                />
              ))}
            </div>
          </SettingsPanel>
        </QueryBoundary>
        <SettingsCard>
          <SettingsRow
            label={t('使用我自己的 agent 配置')}
            hint={
              ownAgentConfig
                ? t('各 agent 读取并可修改执行机上你自己的钩子、技能、全局指令和 MCP 配置')
                : t('各 agent 只用 Cairn 自己的配置，从执行机带入的只有登录凭据')
            }
          >
            <ToggleSwitch
              aria-label={t('使用我自己的 agent 配置')}
              checked={ownAgentConfig}
              onCheckedChange={commitOwnAgentConfig}
            />
          </SettingsRow>
        </SettingsCard>
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
