// #1259 机器详情页（/app/resources/machines/:id）：机器的完整面——事实条
// （runtime/版本/并发/在线）+ 归属该机（归属机 = 它）的 agent 网格（复用
// team 页卡网格）+ 「在这台机器新建 agent」（预选归属机）+ 生命周期出口
// （整机迁移 / 删除——有绑定 agent 时删除被 server 409 拒，按钮先禁并写明
// 原因）。

import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useApiMutations, useMachines, useMembers, useModelSources } from '../api/hooks.js';
import { mapMachines, mapTeam, toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { CreateAgentDialog } from '../routes/create-agent-dialog.js';
import { TeamAgentGrid } from '../routes/team-agent-grid.js';
import { CONCURRENCY_SOURCE_LABEL, MACHINES_HREF } from './machines-page.js';
import { ResourceShell } from './shell.js';

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
      // 部分迁移合法：被拒的留原机——原因必须可见（成功 toast 指名数量，
      // 逐项处置回详情页/agent 编辑面）。
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
      <ResourceShell
        title={t('机器')}
        href={MACHINES_HREF}
        backHref={MACHINES_HREF}
        selected={MACHINES_HREF}
        fixture={fixture}
      >
        <div className="p-4 text-sm text-muted-foreground">{t('机器不存在或已移除')}</div>
      </ResourceShell>
    );
  }

  return (
    <ResourceShell
      title={machine.name}
      href={MACHINES_HREF}
      backHref={MACHINES_HREF}
      selected={MACHINES_HREF}
      fixture={fixture}
    >
      <div className="flex flex-col gap-4 p-4">
        {/* 事实条：runtime 开关 / 版本 / 并发 / 在线态。 */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-(--text-secondary)">
          <span data-testid="machine-detail-online">
            {machine.online !== false ? t('在线') : t('离线')}
          </span>
          <span aria-hidden="true">·</span>
          <span>{(machine.enabledRuntimes ?? []).join(' / ') || t('无 runtime 开启')}</span>
          {machine.maxConcurrent !== undefined && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {t('并发 {running}/{cap}', {
                  running: machine.runningSteps ?? 0,
                  cap: machine.maxConcurrent,
                })}
              </span>
              {machine.concurrencySource !== undefined && (
                <span data-concurrency-source={machine.concurrencySource}>
                  {t(CONCURRENCY_SOURCE_LABEL[machine.concurrencySource])}
                </span>
              )}
            </>
          )}
        </div>

        {/* 生命周期出口：整机迁移 + 删除（有绑定 agent 时删除禁用，server
            同律 409）。 */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={evacuateTarget} onValueChange={(v) => setEvacuateTarget(v as string)}>
            <SelectTrigger className="machine-evacuate-select">
              <SelectValue>
                {others.find((m) => m.id === evacuateTarget)?.name ?? t('迁移到…')}
              </SelectValue>
            </SelectTrigger>
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
            disabled={evacuateTarget === null || evacuating || homeAgents.length === 0}
            onClick={evacuate}
            data-testid="machine-evacuate-btn"
          >
            {t('整机迁移')}
          </Button>
          <Button
            variant="outline"
            disabled={deleting || homeAgents.length > 0}
            onClick={remove}
            data-testid="machine-delete-btn"
          >
            {homeAgents.length > 0
              ? t('删除（先迁走 {n} 个 agent）', { n: homeAgents.length })
              : t('删除')}
          </Button>
        </div>

        <TeamAgentGrid
          agents={homeAgents}
          machines={machines}
          onCreate={() => setCreateOpen(true)}
          search={search}
        />
      </div>
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
    </ResourceShell>
  );
}
