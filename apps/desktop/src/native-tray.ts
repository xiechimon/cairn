import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  type DesktopRunnerState,
  type DesktopTrayOpen,
  KEEP_AWAKE_ITEM_IDS,
  type KeepAwakeMode,
  keepAwakeModeForItemId,
  type NativeTrayItem,
  type NativeTrayMenu,
  parseNativeTrayMenu,
} from '@cairn/shared/desktop-shell';
import type { DesktopLocale } from './locale.js';
import type { RestartBudget } from './restart-budget.js';

export const NATIVE_TRAY_READY_MS = 5_000;
export const NATIVE_TRAY_RESTART_DELAYS_MS = [1_000, 2_000, 4_000];

export type NativeTrayAction =
  | { kind: 'open'; target: DesktopTrayOpen }
  | { kind: 'runner'; on: boolean }
  | { kind: 'keep-awake'; mode: KeepAwakeMode }
  | { kind: 'quit' };

export function nativeTrayAction(menu: NativeTrayMenu, id: unknown): NativeTrayAction | null {
  if (typeof id !== 'string') return null;
  const item = menu.items.find((candidate) => candidate.id === id);
  if (item === undefined) return null;
  switch (item.kind) {
    case 'row':
      return item.open === undefined ? null : { kind: 'open', target: item.open };
    case 'switch':
      if (!item.enabled) return null;
      return { kind: 'runner', on: !item.on };
    case 'choice': {
      if (!item.enabled) return null;
      const mode = keepAwakeModeForItemId(item.id);
      return mode === null ? null : { kind: 'keep-awake', mode };
    }
    case 'command':
      return item.id === 'quit'
        ? { kind: 'quit' }
        : { kind: 'open', target: { kind: 'command', command: 'settings' } };
    default:
      return null;
  }
}

const SKELETON_COPY: Record<
  DesktopLocale,
  {
    open: string;
    heading: string;
    screenOn: string;
    system: string;
    lidClosed: string;
    quit: string;
  }
> = {
  zh: {
    open: '打开 Cairn',
    heading: '有任务运行时保持唤醒',
    screenOn: '屏幕常亮',
    system: '屏幕可熄灭',
    lidClosed: '合盖继续运行',
    quit: '退出 Cairn',
  },
  en: {
    open: 'Open Cairn',
    heading: 'Stay awake while tasks run',
    screenOn: 'Keep the screen on',
    system: 'Let the screen sleep',
    lidClosed: 'Keep running with the lid closed',
    quit: 'Quit Cairn',
  },
};

function keepAwakeChoices(
  locale: DesktopLocale,
  lidClosedAvailable: boolean,
  includeTitle: boolean,
): NativeTrayItem[] {
  const copy = SKELETON_COPY[locale];
  return [
    ...(includeTitle
      ? [{ kind: 'header' as const, id: 'keep-awake-title', title: copy.heading }]
      : []),
    {
      kind: 'choice',
      id: KEEP_AWAKE_ITEM_IDS['screen-on'],
      title: copy.screenOn,
      on: false,
      enabled: true,
    },
    {
      kind: 'choice',
      id: KEEP_AWAKE_ITEM_IDS.system,
      title: copy.system,
      on: true,
      enabled: true,
    },
    ...(lidClosedAvailable
      ? [
          {
            kind: 'choice' as const,
            id: KEEP_AWAKE_ITEM_IDS['lid-closed'],
            title: copy.lidClosed,
            on: false,
            enabled: true,
          },
        ]
      : []),
  ];
}

export function skeletonTrayMenu(locale: DesktopLocale): NativeTrayMenu {
  const copy = SKELETON_COPY[locale];
  return {
    label: 'Cairn',
    items: [
      {
        kind: 'row',
        id: 'open',
        title: copy.open,
        image: 'brand',
        open: { kind: 'path', path: '/app' },
      },
      { kind: 'separator', id: 'controls-rule' },
      ...keepAwakeChoices(locale, true, true),
      { kind: 'separator', id: 'account-rule' },
      { kind: 'command', id: 'quit', title: copy.quit, key: 'q' },
    ],
  };
}

export function withHostState(
  menu: NativeTrayMenu,
  state: {
    keepAwake: KeepAwakeMode;
    lidClosedAvailable: boolean;
    runner: DesktopRunnerState;
  },
  locale: DesktopLocale = 'en',
): NativeTrayMenu {
  const effective =
    state.keepAwake === 'lid-closed' && !state.lidClosedAvailable ? 'system' : state.keepAwake;
  const filtered = menu.items.filter(
    (item) =>
      item.kind !== 'choice' ||
      item.id !== KEEP_AWAKE_ITEM_IDS['lid-closed'] ||
      state.lidClosedAvailable,
  );
  const hasChoices = filtered.some(
    (item) => item.kind === 'choice' && keepAwakeModeForItemId(item.id) !== null,
  );
  let items = filtered;
  if (!hasChoices) {
    const hasTitle = filtered.some(
      (item) => item.kind === 'header' && item.id === 'keep-awake-title',
    );
    const synthesized = keepAwakeChoices(locale, state.lidClosedAvailable, !hasTitle);
    const runnerIndex = filtered.findIndex(
      (item) => item.kind === 'switch' && item.id === 'runner',
    );
    if (runnerIndex >= 0) {
      items = [
        ...filtered.slice(0, runnerIndex + 1),
        ...synthesized,
        ...filtered.slice(runnerIndex + 1),
      ];
    } else {
      const tailIndex = filtered.findIndex(
        (item) => item.id === 'settings' || item.id === 'account-rule' || item.id === 'quit',
      );
      items =
        tailIndex >= 0
          ? [...filtered.slice(0, tailIndex), ...synthesized, ...filtered.slice(tailIndex)]
          : [...filtered, ...synthesized];
    }
  }
  return {
    ...menu,
    items: items.map((item) => {
      if (item.kind !== 'choice') return item;
      const mode = keepAwakeModeForItemId(item.id);
      return mode === null ? item : { ...item, on: mode === effective };
    }),
  };
}

export function nativeMenuWithHostState(
  pageMenu: NativeTrayMenu | null,
  locale: DesktopLocale,
  state: {
    keepAwake: KeepAwakeMode;
    lidClosedAvailable: boolean;
    runner: DesktopRunnerState;
  },
): NativeTrayMenu {
  return withHostState(pageMenu ?? skeletonTrayMenu(locale), state, locale);
}

export function createNativeTrayMenuReceiver(
  log: (line: string) => void,
): (input: unknown) => NativeTrayMenu | null {
  let lastFailureKey: string | null = null;
  return (input: unknown): NativeTrayMenu | null => {
    const result = parseNativeTrayMenu(input);
    if (!result.ok) {
      const summary = result.issues.join('; ');
      const key = `reject:${summary}`;
      if (key !== lastFailureKey) {
        lastFailureKey = key;
        log(`Cairn tray: the page sent a menu that does not match the schema (${summary})`);
      }
      return null;
    }
    if (result.dropped.length > 0) {
      const summary = result.dropped.join('; ');
      const key = `drop:${summary}`;
      if (key !== lastFailureKey) {
        lastFailureKey = key;
        log(
          `Cairn tray: dropped ${result.dropped.length} menu item(s) that did not match the schema (${summary})`,
        );
      }
      return result.menu;
    }
    lastFailureKey = null;
    return result.menu;
  };
}

export type NativeTrayEvent =
  | { type: 'ready' }
  | { type: 'opened' }
  | { type: 'closed' }
  | { type: 'action'; id: string };

function parseEvent(line: string): NativeTrayEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { type, id } = value as { type?: unknown; id?: unknown };
  if (type === 'ready' || type === 'opened' || type === 'closed') return { type };
  if (type === 'action' && typeof id === 'string') return { type, id };
  return null;
}

export interface NativeTrayHost {
  up: () => void;
  down: () => void;
  event: (event: NativeTrayEvent) => void;
  log: (line: string) => void;
}

export type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface NativeTrayOptions {
  command: string;
  args: string[];
  spawn: Spawn;
  budget: RestartBudget;
  host: NativeTrayHost;
  readyMs?: number;
  delaysMs?: number[];
}

export interface NativeTray {
  send: (message: object) => void;
  isUp: () => boolean;
  stop: () => void;
}

export function startNativeTray(options: NativeTrayOptions): NativeTray {
  const { host, budget } = options;
  const readyMs = options.readyMs ?? NATIVE_TRAY_READY_MS;
  const delays = options.delaysMs ?? NATIVE_TRAY_RESTART_DELAYS_MS;
  let child: ChildProcess | null = null;
  let up = false;
  let stopped = false;
  let restarts = 0;
  let readyTimer: NodeJS.Timeout | null = null;
  let restartTimer: NodeJS.Timeout | null = null;

  const clearReady = (): void => {
    if (readyTimer !== null) clearTimeout(readyTimer);
    readyTimer = null;
  };

  const gone = (owner: ChildProcess | null, reason: string): void => {
    if (child !== owner) return;
    child = null;
    clearReady();
    const wasUp = up;
    up = false;
    if (stopped) return;
    host.log(`the native tray stopped: ${reason}`);
    if (wasUp || restarts === 0) host.down();
    if (!budget.exited()) {
      host.log('the native tray keeps failing; the web popover stays for this session');
      return;
    }
    const delay = delays[Math.min(restarts, delays.length - 1)] ?? 0;
    restarts += 1;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      launch();
    }, delay);
  };

  const launch = (): void => {
    if (stopped) return;
    budget.started();
    let spawned: ChildProcess;
    try {
      spawned = options.spawn(options.command, options.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      child = null;
      gone(null, error instanceof Error ? error.message : String(error));
      return;
    }
    child = spawned;
    spawned.on('error', (error) => gone(spawned, error.message));
    spawned.on('exit', (code, signal) => gone(spawned, `exit ${code ?? signal}`));
    spawned.stdin?.on('error', () => {});
    if (spawned.stderr !== null && spawned.stderr !== undefined) {
      createInterface({ input: spawned.stderr }).on('line', (line) => host.log(line));
    }
    if (spawned.stdout !== null && spawned.stdout !== undefined) {
      createInterface({ input: spawned.stdout }).on('line', (line) => {
        if (child !== spawned) return;
        const event = parseEvent(line);
        if (event === null) {
          host.log(`the native tray sent an unreadable line: ${line.slice(0, 200)}`);
          return;
        }
        if (event.type === 'ready') {
          if (up) return;
          clearReady();
          up = true;
          host.up();
          return;
        }
        if (up) host.event(event);
      });
    }
    readyTimer = setTimeout(() => {
      readyTimer = null;
      if (child !== spawned || up) return;
      spawned.kill('SIGKILL');
      gone(spawned, `no ready in ${readyMs} ms`);
    }, readyMs);
  };

  launch();

  return {
    send(message) {
      if (!up || child === null) return;
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    },
    isUp: () => up,
    stop() {
      stopped = true;
      clearReady();
      if (restartTimer !== null) clearTimeout(restartTimer);
      restartTimer = null;
      up = false;
      const owned = child;
      child = null;
      owned?.stdin?.end();
    },
  };
}
