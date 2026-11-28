import type {
  DesktopRunnerState,
  DesktopTrayState,
  NativeTrayItem,
  NativeTrayMenu,
} from '@cairn/shared';
import {
  createKeepAwakeDisclosure,
  isKeepAwakeMode,
  NATIVE_TRAY_MAX_ID,
  NATIVE_TRAY_MAX_ITEMS,
  NATIVE_TRAY_MAX_TEXT,
} from '@cairn/shared';
import type { TVars } from '../i18n/translate.js';
import { USAGE_PATH } from '../resources/hrefs.js';
import type { TrayGroup, TrayMachineState, TrayText, TrayUsage } from './tray-groups.js';

function clampText(value: string, max: number = NATIVE_TRAY_MAX_TEXT): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function clampId(value: string): string {
  const trimmed = value.slice(0, NATIVE_TRAY_MAX_ID);
  return trimmed.length > 0 ? trimmed : 'item';
}

export const RUNNER_WORD: Record<DesktopRunnerState, string> = {
  starting: '正在启动',
  on: '运行中',
  off: '已关闭',
  failed: '已停止',
};

type Translate = (key: string, vars?: TVars) => string;

export interface TrayMenuInput {
  groups: readonly TrayGroup[];
  usage: TrayUsage | null;
  coordinatorBusy: boolean;
  state: DesktopTrayState | null;
  userName: string;
  now: number;
  t: Translate;
}

type Reading = NonNullable<Extract<NativeTrayItem, { kind: 'header' }>['reading']>;

const STRAIN_WORD = { memory: '内存吃紧', cpu: 'CPU 吃紧', disk: '磁盘吃紧' } as const;

function ago(lastSeenAt: number, now: number, t: Translate): string {
  const n = Math.max(0, Math.floor((now - lastSeenAt) / 60_000));
  if (n < 60) return t('{n} 分钟前', { n });
  if (n < 24 * 60) return t('{n} 小时前', { n: Math.floor(n / 60) });
  return t('{n} 天前', { n: Math.floor(n / (24 * 60)) });
}

export function machineReading(state: TrayMachineState, now: number, t: Translate): Reading {
  if (state.kind === 'offline') {
    const text = clampText(
      state.lastSeenAt === null
        ? t('离线')
        : t('离线 · 最后在线 {ago}', { ago: ago(state.lastSeenAt, now, t) }),
    );
    return {
      parts: [{ text, strained: false }],
      faint: true,
      spoken: text,
      tip: clampText(t('离线时读数已过期，不显示')),
    };
  }
  if (state.kind === 'unreported') {
    const text = clampText(t('尚未上报内存和负载'));
    return { parts: [{ text, strained: false }], faint: true, spoken: text, tip: text };
  }
  const mem = Math.round((state.memory ?? 0) * 100);
  const load = state.load.toFixed(1);
  const loadText = t('负载 {load} / {cores} 核', { load, cores: state.cores });
  const parts: Reading['parts'] = [];
  if (state.memory !== null) {
    parts.push({
      text: clampText(t('内存 {mem}%', { mem })),
      strained: state.strain.includes('memory'),
    });
  }
  const cpu = state.cpu === null ? null : Math.round(state.cpu * 100);
  if (cpu !== null) {
    parts.push({ text: clampText(`CPU ${cpu}%`), strained: state.strain.includes('cpu') });
  }
  parts.push({ text: clampText(loadText), strained: false });
  if (state.strain.includes('disk')) {
    parts.push({
      text: clampText(t('剩余磁盘 {disk} GB', { disk: state.diskGb })),
      strained: true,
    });
  }
  const tip = clampText(
    cpu === null
      ? t('内存压力 {mem}%；负载 {load} / {cores} 核；剩余磁盘 {disk} GB', {
          mem,
          load,
          cores: state.cores,
          disk: state.diskGb,
        })
      : t('内存压力 {mem}%；CPU {cpu}%；负载 {load} / {cores} 核；剩余磁盘 {disk} GB', {
          mem,
          cpu,
          load,
          cores: state.cores,
          disk: state.diskGb,
        }),
  );
  const spoken = clampText(
    [...state.strain.map((reason) => t(STRAIN_WORD[reason])), ...parts.map((p) => p.text)].join(
      ', ',
    ),
  );
  return { parts, faint: false, spoken, tip };
}

export function trayMenuModel({
  groups,
  usage,
  coordinatorBusy,
  state,
  userName,
  now,
  t,
}: TrayMenuInput): NativeTrayMenu {
  const say = (text: TrayText) => t(text.key, text.vars);
  const headItems: NativeTrayItem[] = [
    {
      kind: 'row',
      id: 'coordinator',
      title: 'Coordinator',
      image: 'brand',
      ...(coordinatorBusy ? { status: clampText(t('正在回复')) } : {}),
      open: { kind: 'path', path: '/app' },
    },
  ];
  if (!groups.some((group) => group.rows.length > 0)) {
    headItems.push({ kind: 'row', id: 'empty', title: clampText(t('没有等你的事')) });
  }
  for (const group of groups) {
    headItems.push({
      kind: 'header',
      id: clampId(group.key),
      title: clampText(group.literal ? group.label : t(group.label)),
      ...(group.machine === undefined ? {} : { reading: machineReading(group.machine, now, t) }),
    });
    for (const row of group.rows) {
      headItems.push({
        kind: 'row',
        id: clampId(`${group.key}/${row.key}`),
        title: clampText(row.note === undefined ? row.title : say(row.note)),
        ...(row.note === undefined ? { glyph: row.glyph } : {}),
        ...(row.hint === undefined ? {} : { status: clampText(say(row.hint)) }),
        ...(row.tip === undefined ? {} : { tip: clampText(say(row.tip)) }),
        ...(row.warn === true ? { warn: true } : {}),
        open: { kind: 'path', path: row.path },
      });
    }
  }
  if (usage !== null) {
    headItems.push({ kind: 'separator', id: 'usage-rule' });
    headItems.push({
      kind: 'row',
      id: 'usage',
      title: clampText(t('今天用了 {tokens} tokens', { tokens: usage.tokens })),
      image: 'usage',
      ...(usage.quota === null ? {} : { status: clampText(say(usage.quota)) }),
      open: { kind: 'path', path: USAGE_PATH },
    });
  }
  const runner = state?.runner ?? 'starting';
  const rawKeepAwake: unknown = state?.keepAwake;
  const storedMode =
    rawKeepAwake === true ? 'screen-on' : isKeepAwakeMode(rawKeepAwake) ? rawKeepAwake : 'system';
  const lidClosedAvailable = state?.lidClosedAvailable ?? false;
  const disclosure = createKeepAwakeDisclosure({
    title: clampText(t('保持唤醒')),
    help: clampText(t('有任务运行时保持唤醒')),
    titles: {
      'screen-on': clampText(t('屏幕常亮')),
      system: clampText(t('屏幕可熄灭')),
      'lid-closed': clampText(t('合盖继续运行')),
    },
    unavailable: clampText(t('需要接通电源')),
    mode: storedMode,
    enabled: state !== null,
    lidClosedAvailable,
  });
  const controlItems: NativeTrayItem[] = [
    { kind: 'separator', id: 'controls-rule' },
    {
      kind: 'switch',
      id: 'runner',
      title: clampText(t('本机执行机')),
      detail: clampText(t(RUNNER_WORD[runner])),
      ...(runner === 'failed' ? { warn: true } : {}),
      on: runner === 'on' || runner === 'starting',
      enabled: state !== null && runner !== 'starting',
    },
    disclosure,
    { kind: 'command', id: 'settings', title: clampText(t('设置')), key: ',' },
    { kind: 'separator', id: 'account-rule' },
    { kind: 'row', id: 'user', title: clampText(userName), image: 'user' },
    { kind: 'command', id: 'quit', title: clampText(t('退出 Cairn')), key: 'q' },
  ];
  const legacyExpansion = typeof rawKeepAwake === 'boolean' ? 0 : lidClosedAvailable ? 3 : 2;
  const headBudget = Math.max(0, NATIVE_TRAY_MAX_ITEMS - controlItems.length - legacyExpansion);
  const items = [...headItems.slice(0, headBudget), ...controlItems].slice(
    0,
    NATIVE_TRAY_MAX_ITEMS,
  );
  return { label: 'Cairn', items };
}

export interface LegacyKeepAwakeSwitchItem {
  kind: 'switch';
  id: 'keep-awake';
  title: string;
  on: boolean;
  enabled: boolean;
}

export interface LegacyCompatibleTrayMenu {
  label: string;
  items: Array<NativeTrayItem | LegacyKeepAwakeSwitchItem>;
}

export function trayMenuForHost(
  input: TrayMenuInput,
  menu = trayMenuModel(input),
): NativeTrayMenu | LegacyCompatibleTrayMenu {
  const rawKeepAwake: unknown = input.state?.keepAwake;
  const items: Array<NativeTrayItem | LegacyKeepAwakeSwitchItem> = [];
  for (const item of menu.items) {
    if (item.kind !== 'disclosure') {
      items.push(item);
      continue;
    }
    if (typeof rawKeepAwake === 'boolean') {
      items.push({
        kind: 'switch',
        id: 'keep-awake',
        title: clampText(input.t('屏幕常亮')),
        on: rawKeepAwake,
        enabled: true,
      });
    } else {
      items.push({ kind: 'header', id: 'keep-awake-title', title: item.help ?? '' });
      for (const child of item.children) {
        if (child.id === 'keep-awake-lid-closed' && input.state?.lidClosedAvailable !== true)
          continue;
        const { tip: _tip, ...flat } = child;
        items.push(flat);
      }
    }
  }
  return { label: menu.label, items };
}
