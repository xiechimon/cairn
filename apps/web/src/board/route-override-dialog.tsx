import {
  type RequiredCapabilities,
  type RouteOverride,
  RUNNER_OS,
  RUNNER_OS_LABELS,
  type RunnerOs,
} from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useMachines, useMcpServers } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { MachineName, machineLabel } from '../components/machine-label.js';
import {
  SETTINGS_HINT_CLS,
  SETTINGS_ROW_CLS,
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
} from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';

function buildOverride(
  machineId: string | null,
  mcpServers: string[],
  kept: RequiredCapabilities | undefined,
  os: RunnerOs | null,
): RouteOverride | null {
  const { mcpServers: _replaced, os: _os, models, ...rest } = kept ?? {};
  const requiredCapabilities: RequiredCapabilities = {
    ...rest,
    ...(os !== null ? { os } : {}),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
    ...(models !== undefined && models.length > 0 ? { models } : {}),
  };
  const hasCaps = Object.keys(requiredCapabilities).length > 0;
  if (machineId === null && !hasCaps) return null;
  return {
    ...(machineId !== null ? { machineId } : {}),
    ...(hasCaps ? { requiredCapabilities } : {}),
  };
}

export function RouteOverrideDialog({
  open,
  onClose,
  todoId,
  initial,
  platformLocked = false,
}: {
  open?: boolean;
  onClose: () => void;
  todoId: string;
  initial: RouteOverride | null | undefined;
  platformLocked?: boolean;
}) {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const active = open === true;
  const machinesQ = useMachines(teamId, live && active);
  const routingQ = useRoutingSettings(teamId, live && active);
  const mcpQ = useMcpServers(teamId, live && active);
  const sessionHasMachine =
    routingQ.data?.rules?.some((rule) => rule.use === 'session' && rule.machineId != null) === true;
  const [machineId, setMachineId] = useState<string | null>(initial?.machineId ?? null);
  const [mcpServers, setMcpServers] = useState<string[]>(
    initial?.requiredCapabilities?.mcpServers ?? [],
  );
  const [platform, setPlatform] = useState<RunnerOs | null>(
    initial?.requiredCapabilities?.os ?? null,
  );

  useEffect(() => {
    if (!open) return;
    setMachineId(initial?.machineId ?? null);
    setMcpServers(initial?.requiredCapabilities?.mcpServers ?? []);
    setPlatform(initial?.requiredCapabilities?.os ?? null);
  }, [open, initial]);

  const machines = live
    ? (machinesQ.data ?? []).map((machine) => ({ id: machine.id, name: machine.name }))
    : (fixture.resources?.machines ?? [])
        .filter((machine): machine is typeof machine & { id: string } => machine.id != null)
        .map((machine) => ({ id: machine.id, name: machine.name }));
  const pickedMachine = machines.find((machine) => machine.id === machineId);
  const mcpOptions = live
    ? (mcpQ.data ?? []).map((row) => ({ id: row.slug, name: row.label }))
    : (fixture.resources?.mcpServers ?? []).map((row) => ({ id: row.name, name: row.name }));

  const toggleMcp = (id: string, on: boolean) => {
    setMcpServers((current) =>
      on ? [...current.filter((row) => row !== id), id] : current.filter((row) => row !== id),
    );
  };

  const save = () => {
    if (!live) {
      onClose();
      return;
    }
    const routeOverride = buildOverride(
      machineId,
      mcpServers,
      initial?.requiredCapabilities,
      platform,
    );
    mutations.patchTodo.mutate(
      { id: todoId, body: { routeOverride } },
      {
        onSuccess: () => {
          toastSuccess(t('路由覆盖已保存'));
          onClose();
        },
        onError: (error) => toastError(t('保存路由覆盖失败，请重试。'), error),
      },
    );
  };

  return (
    <DialogShell
      title={t('路由覆盖')}
      subtitle={t('本任务的机器与执行要求；调度在规则开启后生效。')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            data-testid="route-override-save"
            disabled={live && mutations.patchTodo.isPending}
            onClick={save}
          >
            {t('保存')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="route-override-dialog">
        <SettingsCard>
          <SettingsRow
            label={t('运行平台')}
            hint={platformLocked ? t('运行中不能改，换平台请新开任务') : t('不限时用默认 Runner')}
          >
            <Select
              value={platform}
              disabled={platformLocked}
              onValueChange={(next) => setPlatform(RUNNER_OS.find((os) => os === next) ?? null)}
            >
              <SelectTrigger
                aria-label={t('运行平台')}
                className={cn(SETTINGS_SELECT_TRIGGER_CLS, 'w-44')}
                data-testid="route-override-platform"
              >
                <SelectValue>
                  {platform === null ? t('不限（默认 Runner）') : RUNNER_OS_LABELS[platform]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>{t('不限（默认 Runner）')}</SelectItem>
                {RUNNER_OS.map((os) => (
                  <SelectItem key={os} value={os}>
                    {RUNNER_OS_LABELS[os]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow label={t('首选机器')} hint={t('不填则沿用规则的机器')}>
            <Select value={machineId} onValueChange={(next) => setMachineId(next)}>
              <SelectTrigger
                aria-label={t('首选机器')}
                className={cn(SETTINGS_SELECT_TRIGGER_CLS, 'w-44')}
                data-testid="route-override-machine"
              >
                <SelectValue>
                  {machineId === null
                    ? t(machines.length > 1 && !sessionHasMachine ? '选择机器' : '不固定')
                    : pickedMachine === undefined
                      ? machineId
                      : machineLabel(pickedMachine, machines)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {machines.length > 1 && !sessionHasMachine ? null : (
                  <SelectItem value={null}>{t('不固定')}</SelectItem>
                )}
                {machines.map((machine) => (
                  <SelectItem key={machine.id} value={machine.id}>
                    <MachineName machine={machine} all={machines} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsCard>
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-card-title font-medium text-foreground">{t('要求的 MCP')}</h3>
          <p className={SETTINGS_HINT_CLS}>{t('派发时要求执行机已安装这些 MCP 服务器')}</p>
          {mcpOptions.length === 0 ? (
            <SettingsCard>
              <div className={cn(SETTINGS_ROW_CLS, 'gap-2')}>
                <p className="m-0 text-ui text-content-secondary">{t('暂无 MCP 服务器。')}</p>
              </div>
            </SettingsCard>
          ) : (
            <SettingsCard>
              {mcpOptions.map((server) => (
                <SettingsRow key={server.id} label={server.name}>
                  <ToggleSwitch
                    aria-label={t('要求安装 {name}', { name: server.name })}
                    data-testid={`route-override-mcp-${server.id}`}
                    checked={mcpServers.includes(server.id)}
                    onCheckedChange={(checked) => toggleMcp(server.id, checked)}
                  />
                </SettingsRow>
              ))}
            </SettingsCard>
          )}
        </section>
      </div>
    </DialogShell>
  );
}
