import type { ComputerRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../api/auth.js';
import { ensureComputerBrowser, patchComputerBrowser } from '../api/computer-screen.js';
import { useComputers } from '../api/hooks.js';
import { invalidateConverged } from '../api/invalidate.js';
import { useLiveData } from '../api/provider.js';
import { browserCapabilityInstalled } from '../board/machine-capabilities.js';
import { SettingsCard, SettingsRow, SettingsSection } from '../components/settings-list.js';
import { ExplainDisabledToggle, ToggleSwitch } from '../components/toggle-switch.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

type HostPermissions = NonNullable<MachineRow['capabilities']>['hostPermissions'];
type HostOsPlatform = NonNullable<MachineRow['capabilities']>['osPlatform'];

function permissionGuidanceRows(
  permissions: HostPermissions,
  osPlatform: HostOsPlatform,
  t: (key: string) => string,
): { testId: string; label: string; hint: string }[] {
  if (permissions === undefined) return [];
  const rows: { testId: string; label: string; hint: string }[] = [];
  if (permissions.accessibility !== 'granted' && permissions.accessibility !== 'not_required') {
    rows.push(
      osPlatform === 'darwin'
        ? {
            testId: 'machine-permission-accessibility',
            label: t('辅助功能未授予'),
            hint: t(
              '在 系统设置 → 隐私与安全性 → 辅助功能 中允许 Cairn，否则 agent 无法读取和操作桌面。',
            ),
          }
        : {
            testId: 'machine-permission-accessibility',
            label: t('桌面辅助通道不可用'),
            hint: t(
              'AT-SPI 辅助总线不可用，agent 将无法读取和操作桌面。请安装并启用 at-spi（如 orca）后重试。',
            ),
          },
    );
  }
  if (permissions.screenRecording !== 'granted' && permissions.screenRecording !== 'not_required') {
    rows.push(
      osPlatform === 'darwin'
        ? {
            testId: 'machine-permission-screen-recording',
            label: t('屏幕录制未授予'),
            hint: t(
              '在 系统设置 → 隐私与安全性 → 屏幕录制 中允许 Cairn，否则 agent 无法截取屏幕。',
            ),
          }
        : {
            testId: 'machine-permission-screen-recording',
            label: t('屏幕截取不可用'),
            hint: t('当前环境无法截取屏幕，agent 的屏幕读取将被拒绝。'),
          },
    );
  }
  return rows;
}

function CapabilitySwitch({
  label,
  hint,
  checked,
  disabled,
  disabledReason,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  disabledReason: string | undefined;
  onCheckedChange: ((checked: boolean) => void) | undefined;
}) {
  const reason = disabled ? (disabledReason ?? hint) : undefined;
  return (
    <SettingsRow label={label} hint={hint}>
      <ExplainDisabledToggle disabled={disabled} reason={reason}>
        <ToggleSwitch
          checked={checked}
          disabled={disabled}
          aria-label={label}
          title={reason}
          onCheckedChange={onCheckedChange}
        />
      </ExplainDisabledToggle>
    </SettingsRow>
  );
}

export function MachineAgentAccess({ machine }: { machine: MachineRow }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { live, teamId } = useLiveData();
  const auth = useAuth();
  const guidanceRows = permissionGuidanceRows(
    machine.capabilities?.hostPermissions,
    machine.capabilities?.osPlatform,
    t,
  );
  const computers = useComputers(teamId, live && !auth.gateOpen).data ?? [];
  const computer: ComputerRecord | null =
    computers.find((row) => row.machine.id === machine.id) ?? null;
  const pinnedElsewhere = computers.some(
    (row) => machine.id !== undefined && row.machine.id !== machine.id,
  );
  const [browserBusy, setBrowserBusy] = useState(false);
  const browserInstalled = browserCapabilityInstalled(machine, computer);
  const browserEnabled = computer?.browserEnabled === true;
  const browserPinnedElsewhere = pinnedElsewhere && computer === null;
  const canToggleBrowser =
    teamId !== undefined &&
    machine.id !== undefined &&
    !browserBusy &&
    !browserPinnedElsewhere &&
    (browserInstalled || browserEnabled);
  const browserHint = browserPinnedElsewhere
    ? t('浏览器偏好已绑定到另一台机器。')
    : browserInstalled
      ? t('让 agent 打开网页、点击和填表。')
      : browserEnabled
        ? t('这台机器已不再报告浏览器能力；可关闭已保存的偏好。')
        : t('这台机器还不支持浏览器。');
  const onBrowserToggle = (checked: boolean) => {
    const machineId = machine.id;
    if (teamId === undefined || machineId === undefined || browserBusy) return;
    if (browserPinnedElsewhere) return;
    if (checked && !browserInstalled) return;
    if (!checked && computer === null) return;
    setBrowserBusy(true);
    const run =
      computer !== null
        ? patchComputerBrowser(computer.id, checked)
        : ensureComputerBrowser(machineId, checked);
    void run
      .then(() => invalidateConverged(qc, { queryKey: ['computers', teamId] }))
      .catch(() => invalidateConverged(qc, { queryKey: ['computers', teamId] }))
      .finally(() => setBrowserBusy(false));
  };

  return (
    <SettingsSection testId="machine-agent-access" title={t('Agent 的权限')}>
      <SettingsCard>
        {guidanceRows.map((row) => (
          <SettingsRow key={row.testId} label={row.label} hint={row.hint} labelTestId={row.testId}>
            <span className="text-meta text-content-secondary">—</span>
          </SettingsRow>
        ))}
        <CapabilitySwitch
          label={t('浏览器')}
          hint={browserHint}
          checked={browserEnabled}
          disabled={!canToggleBrowser}
          disabledReason={browserHint}
          onCheckedChange={canToggleBrowser ? onBrowserToggle : undefined}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
