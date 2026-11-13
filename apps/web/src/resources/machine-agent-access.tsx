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
