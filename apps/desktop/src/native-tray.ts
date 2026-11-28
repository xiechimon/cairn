import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  createKeepAwakeDisclosure,
  type DesktopRunnerState,
  type DesktopTrayOpen,
  KEEP_AWAKE_ITEM_IDS,
  type KeepAwakeMode,
  keepAwakeModeForItemId,
  NATIVE_TRAY_MAX_ITEMS,
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
  const item = menu.items
    .flatMap<NativeTrayItem>((candidate) =>
      candidate.kind === 'disclosure'
        ? candidate.enabled
          ? candidate.children
          : []
        : candidate.kind === 'choice'
          ? []
          : [candidate],
    )
    .find((candidate) => candidate.id === id);
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
    title: string;
    unavailable: string;
    screenOn: string;
    system: string;
    lidClosed: string;
    quit: string;
  }
> = {
  zh: {
    open: '打开 Cairn',
    heading: '有任务运行时保持唤醒',
    title: '保持唤醒',
    unavailable: '需要接通电源',
    screenOn: '屏幕常亮',
    system: '屏幕可熄灭',
    lidClosed: '合盖继续运行',
    quit: '退出 Cairn',
  },
  en: {
    open: 'Open Cairn',
    heading: 'Stay awake while tasks run',
    title: 'Stay awake',
    unavailable: 'Requires AC power',
    screenOn: 'Keep the screen on',
    system: 'Let the screen sleep',
    lidClosed: 'Keep running with the lid closed',
    quit: 'Quit Cairn',
  },
};

function keepAwakeTile(
  locale: DesktopLocale,
  mode: KeepAwakeMode,
  lidClosedAvailable: boolean,
  enabled: boolean,
  existing?: Extract<NativeTrayItem, { kind: 'disclosure' }>,
  choices: Extract<NativeTrayItem, { kind: 'choice' }>[] = [],
  help?: string,
): Extract<NativeTrayItem, { kind: 'disclosure' }> {
  const copy = SKELETON_COPY[locale];
  const titleFor = (id: string, fallback: string) =>
    choices.find((choice) => choice.id === id)?.title ??
    existing?.children.find((choice) => choice.id === id)?.title ??
    fallback;
  return createKeepAwakeDisclosure({
    title: existing?.title ?? copy.title,
    help: existing?.help ?? help ?? copy.heading,
    titles: {
      'screen-on': titleFor(KEEP_AWAKE_ITEM_IDS['screen-on'], copy.screenOn),
      system: titleFor(KEEP_AWAKE_ITEM_IDS.system, copy.system),
      'lid-closed': titleFor(KEEP_AWAKE_ITEM_IDS['lid-closed'], copy.lidClosed),
    },
    unavailable: copy.unavailable,
    mode,
    enabled,
    lidClosedAvailable,
  });
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
      keepAwakeTile(locale, 'system', true, true),
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
  const existing = menu.items.find((item) => item.kind === 'disclosure');
  const choices = menu.items.filter(
    (item): item is Extract<NativeTrayItem, { kind: 'choice' }> => item.kind === 'choice',
  );
  const header = menu.items.find(
    (item) => item.kind === 'header' && item.id === 'keep-awake-title',
  );
  const tile = keepAwakeTile(
    locale,
    state.keepAwake,
    state.lidClosedAvailable,
    true,
    existing,
    choices,
    header?.kind === 'header' ? header.title : undefined,
  );
  const first = menu.items.findIndex(
    (item) =>
      item.kind === 'disclosure' ||
      item.kind === 'choice' ||
      (item.kind === 'header' && item.id === 'keep-awake-title'),
  );
  const filtered = menu.items.filter(
    (item) =>
      item.kind !== 'disclosure' &&
      item.kind !== 'choice' &&
      !(item.kind === 'header' && item.id === 'keep-awake-title'),
  );
  let index = first;
  if (index < 0) {
    const runner = filtered.findIndex((item) => item.kind === 'switch' && item.id === 'runner');
    const tail = filtered.findIndex(
      (item) => item.id === 'settings' || item.id === 'account-rule' || item.id === 'quit',
    );
    index = runner >= 0 ? runner + 1 : tail >= 0 ? tail : filtered.length;
  }
  filtered.splice(Math.min(index, filtered.length), 0, tile);
  if (filtered.length > NATIVE_TRAY_MAX_ITEMS) {
    const removable = filtered.findIndex(
      (item) =>
        item !== tile && item.id !== 'settings' && item.id !== 'quit' && item.id !== 'account-rule',
    );
    const indexToRemove = removable >= 0 ? removable : filtered.findIndex((item) => item !== tile);
    if (indexToRemove >= 0) filtered.splice(indexToRemove, filtered.length - NATIVE_TRAY_MAX_ITEMS);
  }
  return { ...menu, items: filtered };
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
