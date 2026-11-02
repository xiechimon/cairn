import { Monitor } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useApiMutations, useMachines, useMembers, useModelSources } from '../api/hooks.js';
import { mapMachines, mapTeam, RUNTIME_LABELS, toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import {
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsDangerZone,
  SettingsRow,
  SettingsSelectTrigger,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Select, SelectContent, SelectItem, SelectValue } from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PageShell } from '../pages/shell.js';
import { CreateAgentDialog } from '../routes/create-agent-dialog.js';
import { TeamAgentGrid } from '../routes/team-agent-grid.js';
import { CONCURRENCY_SOURCE_LABEL, MACHINES_HREF } from './machines-page.js';
import { OnlineStatus } from './parts.js';

export function MachineDetailPage() {
  const { t } = useI18n();
  const { search } = useLocation();
  const navigate = useNavigate();
  const machineId = useParams<{ id: string }>().id ?? '';
  const fixture = resolveScenario(new URLSearchParams(search));
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const machines = live ? mapMachines(machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  const machine = machines.find((m) => m.id === machineId) ?? null;

  const membersQ = useMembers(teamId, live);
  const agents = live ? mapTeam(membersQ.data ?? []).agents : (fixture.team?.agents ?? []);
  const homeAgents = agents.filter((a) => a.machineId === machineId);

  const modelSourcesQ = useModelSources(teamId, live);
  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);

  const mutations = useApiMutations(teamId);
  const [createOpen, setCreateOpen] = useState(false);
  const [evacuateTarget, setEvacuateTarget] = useState<string | null>(null);
  const [evacuating, setEvacuating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const others = machines.filter((m) => m.id !== machineId);

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
      navigate({ pathname: MACHINES_HREF, search });
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
      navigate({ pathname: MACHINES_HREF, search });
    } catch (error) {
      toastError(t('删除机器失败，请重试。'), error);
    } finally {
      setDeleting(false);
    }
  };

  if (machine === null) {
    return (
      <PageShell
        route={MACHINES_HREF}
        title={t('机器')}
        back={MACHINES_HREF}
        selected={MACHINES_HREF}
        fixture={fixture}
      >
        <EmptyState className="mt-6" icon={Monitor} title={t('机器不存在或已移除')} />
      </PageShell>
    );
  }

  return (
    <PageShell
      route={MACHINES_HREF}
      title={machine.name}
      back={MACHINES_HREF}
      selected={MACHINES_HREF}
      fixture={fixture}
    >
      <div className="flex flex-col gap-6 pt-4">
        <SettingsCard>
          <SettingsRow label={t('状态')}>
            <span data-testid="machine-detail-online">
              <OnlineStatus on={machine.online !== false} />
            </span>
          </SettingsRow>
          <SettingsRow label={t('运行时')}>
            <span className="text-content-secondary">
              {(machine.enabledRuntimes ?? [])
                .map((r) =>
                  r in RUNTIME_LABELS ? RUNTIME_LABELS[r as keyof typeof RUNTIME_LABELS] : r,
                )
                .join(' / ') || t('无 runtime 开启')}
            </span>
          </SettingsRow>
          {machine.maxConcurrent !== undefined && (
            <SettingsRow label={t('并发上限')}>
              <span className="tabular-nums text-content-secondary">
                {t('并发 {running}/{cap}', {
                  running: machine.runningSteps ?? 0,
                  cap: machine.maxConcurrent,
                })}
              </span>
              {machine.concurrencySource !== undefined && (
                <span
                  className="text-meta text-content-tertiary"
                  data-concurrency-source={machine.concurrencySource}
                >
                  {t(CONCURRENCY_SOURCE_LABEL[machine.concurrencySource])}
                </span>
              )}
            </SettingsRow>
          )}
          <SettingsRow
            label={t('整机迁移')}
            hint={t('把归属这台机器的 agent 一起迁到另一台机器。')}
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

        <TeamAgentGrid
          agents={homeAgents}
          machines={machines}
          onCreate={() => setCreateOpen(true)}
          search={search}
        />

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
      </div>
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
    </PageShell>
  );
}
