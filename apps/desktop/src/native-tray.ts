import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { DesktopRunnerState, DesktopTrayOpen, NativeTrayMenu } from '@cairn/shared';
import type { DesktopLocale } from './locale.js';
import type { RestartBudget } from './restart-budget.js';

export const NATIVE_TRAY_READY_MS = 5_000;
export const NATIVE_TRAY_RESTART_DELAYS_MS = [1_000, 2_000, 4_000];

export type NativeTrayAction =
  | { kind: 'open'; target: DesktopTrayOpen }
  | { kind: 'runner'; on: boolean }
  | { kind: 'keep-awake'; on: boolean }
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
      return item.id === 'runner'
        ? { kind: 'runner', on: !item.on }
        : { kind: 'keep-awake', on: !item.on };
    case 'command':
      return item.id === 'quit'
        ? { kind: 'quit' }
        : { kind: 'open', target: { kind: 'command', command: 'settings' } };
    default:
      return null;
  }
}

const SKELETON_COPY: Record<DesktopLocale, { open: string; keepAwake: string; quit: string }> = {
  zh: { open: '打开 Cairn', keepAwake: '保持屏幕常亮', quit: '退出 Cairn' },
  en: { open: 'Open Cairn', keepAwake: 'Keep the screen on', quit: 'Quit Cairn' },
};

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
      { kind: 'switch', id: 'keep-awake', title: copy.keepAwake, on: false, enabled: true },
      { kind: 'separator', id: 'account-rule' },
      { kind: 'command', id: 'quit', title: copy.quit, key: 'q' },
    ],
  };
}

export function withHostState(
  menu: NativeTrayMenu,
  state: { keepAwake: boolean; runner: DesktopRunnerState },
): NativeTrayMenu {
  return {
    ...menu,
    items: menu.items.map((item) =>
      item.kind === 'switch' && item.id === 'keep-awake' ? { ...item, on: state.keepAwake } : item,
    ),
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
