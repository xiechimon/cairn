import type { MachineFolderPin, MachineFolderPinOp } from '@cairn/shared';
import { cn } from 'cn';
import { type ReactNode, useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ExplainDisabledToggle, ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ChevronDown } from '../icons/index.js';

function pinStatusText(pin: MachineFolderPin, t: TFunc): string {
  switch (pin.status) {
    case 'pending':
      return t('待 Runner 确认');
    case 'rejected':
      return t('路径无效');
    case 'absent':
      return t('已不可用');
    default:
      return pin.enabled ? t('已开放') : t('未开放');
  }
}

export function useFolderGrantsRow(machine: MachineRow): {
  meta: ReactNode;
  drawer: ReactNode;
} {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const grants = machine.folderGrants;
  const pins = grants?.pins ?? [];
  const count = pins.length + (grants?.workspacesDir !== undefined ? 1 : 0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const send = (path: string, op: MachineFolderPinOp['op'], failure: string) => {
    if (!live || machine.id === undefined) {
      blockDemoWrite();
      return;
    }
    mutations.patchMachine.mutate(
      { id: machine.id, body: { folderPins: [{ path, op }] } },
      { onError: (error) => toastError(failure, error) },
    );
  };

  if (grants == null || count === 0) {
    return { meta: null, drawer: null };
  }

  const meta = (
    <>
      <span aria-hidden className="text-content-dim">
        ·
      </span>
      <Button
        variant="ghost"
        data-testid="folder-grants-meta"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="h-auto min-h-0 gap-0.5 rounded-sm px-0 py-0 text-meta font-normal whitespace-nowrap text-content-tertiary hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-(--focus-ring) dark:hover:bg-transparent pointer-coarse:min-h-11"
      >
        {t('{n} 个文件夹', { n: count })}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3 flex-none transition-transform duration-(--dur-fast)',
            open && 'rotate-180',
          )}
        />
      </Button>
    </>
  );

  const pinRow = (pin: MachineFolderPin) => {
    const confirmed = pin.status === 'confirmed';
    const bindable = grants.bindsGrants === true;
    const switchEl = (
      <ToggleSwitch
        data-testid="folder-grant-switch"
        checked={pin.enabled}
        disabled={!bindable || mutations.patchMachine.isPending}
        onCheckedChange={(next) =>
          send(pin.path, next ? 'enable' : 'disable', t('没能更改文件夹开放状态，请重试'))
        }
        aria-label={t('让 Coordinator 使用这个文件夹')}
      />
    );
    return (
      <li
        key={pin.path}
        data-testid="folder-grant"
        data-status={pin.status}
        className="flex min-w-0 items-center gap-3 py-1"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-ui text-foreground">{pin.path}</span>
          <span
            data-testid="folder-grant-status"
            className={cn(
              'truncate text-meta',
              pin.status === 'rejected' || pin.status === 'absent'
                ? 'text-content-tertiary'
                : 'text-content-secondary',
            )}
          >
            {pinStatusText(pin, t)}
          </span>
        </span>
        {confirmed && (
          <ExplainDisabledToggle
            disabled={!bindable}
            reason={t('启动边界还没准备好，暂时不能开放')}
          >
            {switchEl}
          </ExplainDisabledToggle>
        )}
        <Button
          variant="ghost"
          size="sm"
          data-testid="folder-grant-remove"
          disabled={mutations.patchMachine.isPending}
          onClick={() => send(pin.path, 'remove', t('没能移除文件夹，请重试'))}
        >
          {t('移除')}
        </Button>
      </li>
    );
  };

  const addPin = () => {
    const path = draft.trim();
    if (path === '') return;
    send(path, 'pin', t('没能固定文件夹，请重试'));
    setDraft('');
  };

  const drawer = !open ? null : (
    <div
      data-testid="folder-grants-drawer"
      className="flex min-w-0 flex-col gap-2 border-t border-border px-4 py-2"
    >
      <ul data-testid="folder-grants" className="m-0 flex list-none flex-col p-0">
        {grants.workspacesDir !== undefined && (
          <li
            data-testid="folder-grant"
            data-status="workspaces"
            className="flex min-w-0 items-center gap-3 py-1"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-ui text-foreground">
                {grants.workspacesDir}
              </span>
              <span className="truncate text-meta text-content-secondary">
                {t('工作目录 · 始终开放')}
              </span>
            </span>
          </li>
        )}
        {pins.map(pinRow)}
      </ul>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          data-testid="folder-grant-input"
          className="h-8 min-w-0 flex-1 font-mono text-ui"
          placeholder={t('要固定的文件夹绝对路径')}
          aria-label={t('要固定的文件夹绝对路径')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addPin();
          }}
        />
        <Button
          variant="outline"
          size="sm"
          data-testid="folder-grant-add"
          disabled={draft.trim() === '' || mutations.patchMachine.isPending}
          onClick={addPin}
        >
          {t('固定')}
        </Button>
      </div>
    </div>
  );

  return { meta, drawer };
}
