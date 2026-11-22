import type { MenuItemConstructorOptions } from 'electron';
import type { DesktopLocale } from './locale.js';
import { trayCopy } from './tray-copy.js';
import type { TrayData, TrayTaskStatus } from './tray-data.js';

export type TrayRunnerState = 'starting' | 'on' | 'stopping' | 'off' | 'failed';

export interface TrayMenuState {
  locale: DesktopLocale;
  runner: TrayRunnerState;
  keepAwake: boolean;
  data: TrayData;
}

export interface TrayMenuActions {
  open: (path: string) => void;
  settings: () => void;
  setRunner: (on: boolean) => void;
  setKeepAwake: (on: boolean) => void;
  quit: () => void;
}

function readable(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function compactTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${n}`;
}

function taskStatus(
  status: TrayTaskStatus,
  copy: ReturnType<typeof trayCopy>,
  time: Intl.DateTimeFormat,
): string {
  switch (status.kind) {
    case 'running':
      return copy.running(status.minutes);
    case 'stalled':
      return copy.stalled(status.minutes);
    case 'waiting-for-runner':
      return copy.waitingForRunner;
    case 'quota':
      return status.retryAt === null
        ? copy.quotaWait
        : copy.quotaWaitUntil(time.format(status.retryAt));
  }
}

export function traySettingsPath(currentUrl: string, origin: string): string | null {
  const current = URL.parse(currentUrl);
  const settings = '/app/settings';
  return current?.origin === origin &&
    (current.pathname === settings || current.pathname.startsWith(`${settings}/`))
    ? null
    : settings;
}

export function trayMenuTemplate(
  { locale, runner, keepAwake, data }: TrayMenuState,
  actions: TrayMenuActions,
): MenuItemConstructorOptions[] {
  const copy = trayCopy(locale);
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const runnerOn = runner === 'starting' || runner === 'on';
  const items: MenuItemConstructorOptions[] = [
    { id: 'coordinator', label: copy.coordinator, click: () => actions.open('/app') },
  ];
  if (data.status !== 'ready') {
    items.push({ id: 'data-status', label: copy[data.status], enabled: false });
  } else {
    if (data.coordinatorBusy) {
      items.push({ id: 'coordinator-status', label: copy.coordinatorBusy, enabled: false });
    }
    if (data.groups.length === 0) {
      items.push({ id: 'no-tasks', label: copy.empty, enabled: false });
    }
    for (const { label, rows } of data.groups) {
      if (label.kind === 'machine') {
        const { pressure, name } = label;
        items.push({
          label:
            pressure === null
              ? readable(name)
              : `${readable(name)} · ${copy.pressure(pressure.percent, copy.pressureLevel[pressure.level])}`,
          enabled: false,
          ...(pressure === null
            ? {}
            : { toolTip: copy.pressureDetail(pressure.memory, pressure.cpu, pressure.disk) }),
        });
      } else {
        items.push({ label: copy[label.kind], enabled: false });
      }
      for (const row of rows) {
        const title = 'more' in row ? copy.more(row.more) : readable(row.title);
        const status = 'status' in row ? row.status : undefined;
        items.push({
          label: status === undefined ? title : `${title} · ${taskStatus(status, copy, time)}`,
          click: () => actions.open(row.path),
        });
      }
    }
    if (data.usage !== null) {
      const { tokens, quota } = data.usage;
      items.push(
        { type: 'separator' },
        { id: 'usage-status', label: copy.today(compactTokens(tokens)), enabled: false },
      );
      if (quota !== null) {
        const label =
          quota.state === 'used'
            ? copy.quota(quota.percent)
            : quota.retryAt === null
              ? copy.quotaExhausted
              : copy.quotaRecovers(time.format(quota.retryAt));
        items.push({ id: 'quota-status', label, enabled: false });
      }
      items.push({ id: 'usage', label: copy.usage, click: () => actions.open('/app/usage') });
    }
  }
  items.push({ type: 'separator' });
  if (runner !== 'on' && runner !== 'off') {
    items.push({ id: 'runner-status', label: copy.runnerStatus[runner], enabled: false });
  }
  items.push(
    {
      id: 'runner',
      label: copy.runner,
      type: 'checkbox',
      checked: runnerOn,
      enabled: runner !== 'starting' && runner !== 'stopping',
      click: () => actions.setRunner(!runnerOn),
    },
    {
      id: 'keep-awake',
      label: copy.keepAwake,
      type: 'checkbox',
      checked: keepAwake,
      click: () => actions.setKeepAwake(!keepAwake),
    },
    { id: 'settings', label: copy.settings, click: actions.settings },
    { type: 'separator' },
  );
  if (data.status === 'ready' && data.displayName !== '')
    items.push({ id: 'owner', label: readable(data.displayName), enabled: false });
  items.push({
    id: 'quit',
    label: copy.quit,
    accelerator: 'CommandOrControl+Q',
    click: actions.quit,
  });
  return items;
}
