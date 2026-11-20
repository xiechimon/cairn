import { cn } from 'cn';
import { type ReactNode, useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ExplainDisabledToggle, ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ChevronDown } from '../icons/index.js';

type GrantField = 'browserOverride' | 'desktopOverride';

function grantStatus(override: boolean | null | undefined, capable: boolean, t: TFunc): string {
  if (!capable) return t('这台执行机还没报这个能力');
  if (override === false) return t('已关闭，Coordinator 不会用它');
  if (override === true) return t('已开启');
  return t('默认开启，关掉可以单独禁掉');
}

export function useComputerGrantsRow(machine: MachineRow): {
  meta: ReactNode;
  drawer: ReactNode;
} {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [open, setOpen] = useState(false);

  const rows: { field: GrantField; label: string; capable: boolean }[] = [
    {
      field: 'browserOverride',
      label: t('浏览器'),
      capable: machine.capabilities?.browser === true,
    },
    {
      field: 'desktopOverride',
      label: t('桌面和命令'),
      capable: machine.capabilities?.computer === true,
    },
  ];

  const send = (field: GrantField, next: boolean | null) => {
    if (!live || machine.id === undefined) {
      blockDemoWrite();
      return;
    }
    mutations.patchMachine.mutate(
      { id: machine.id, body: { [field]: next } },
      { onError: (error) => toastError(t('没能更改电脑控制，请重试'), error) },
    );
  };

  const shown =
    machine.browserOverride != null ||
    machine.desktopOverride != null ||
    rows.some((row) => row.capable);
  if (!shown) return { meta: null, drawer: null };

  const grants = rows.filter((row) => row.capable);
  const offCount = grants.filter(
    (row) =>
      (row.field === 'browserOverride' ? machine.browserOverride : machine.desktopOverride) ===
      false,
  ).length;
  const segment = offCount > 0 ? t('电脑控制 · {n} 项已关', { n: offCount }) : t('电脑控制');

  const meta = (
    <>
      <span aria-hidden className="text-content-dim">
        ·
      </span>
      <Button
        variant="ghost"
        data-testid="computer-grants-meta"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'h-auto min-h-0 gap-0.5 rounded-sm px-0 py-0 text-meta font-normal whitespace-nowrap hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-(--focus-ring) dark:hover:bg-transparent pointer-coarse:min-h-11',
          offCount > 0 ? 'text-(--waiting-ink)' : 'text-content-tertiary',
        )}
      >
        {segment}
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

  const grantRow = (row: (typeof rows)[number]) => {
    const override = machine[row.field];
    const on = row.capable && override !== false;
    const switchEl = (
      <ToggleSwitch
        data-testid={`computer-grant-switch-${row.field}`}
        checked={on}
        disabled={!row.capable || mutations.patchMachine.isPending}
        onCheckedChange={(next) => send(row.field, next ? null : false)}
        aria-label={t('让 Coordinator 使用{label}', { label: row.label })}
      />
    );
    return (
      <li
        key={row.field}
        data-testid={`computer-grant-${row.field}`}
        data-grant={override === false ? 'off' : row.capable ? 'on' : 'unavailable'}
        className="flex min-w-0 items-center gap-3 py-1"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui text-foreground">{row.label}</span>
          <span
            data-testid={`computer-grant-status-${row.field}`}
            className={cn(
              'truncate text-meta',
              row.capable && override !== false
                ? 'text-content-secondary'
                : 'text-content-tertiary',
            )}
          >
            {grantStatus(override, row.capable, t)}
          </span>
        </span>
        <ExplainDisabledToggle disabled={!row.capable} reason={t('等这台执行机报了这个能力才能开')}>
          {switchEl}
        </ExplainDisabledToggle>
      </li>
    );
  };

  const drawer = !open ? null : (
    <div
      data-testid="computer-grants-drawer"
      className="flex min-w-0 flex-col gap-2 border-t border-border px-4 py-2"
    >
      <ul data-testid="computer-grants" className="m-0 flex list-none flex-col p-0">
        {rows.map(grantRow)}
      </ul>
    </div>
  );

  return { meta, drawer };
}
