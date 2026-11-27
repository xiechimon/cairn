import type {
  DesktopRunnerState,
  DesktopTrayState,
  NativeTrayItem,
  NativeTrayMenu,
} from '@cairn/shared';
import { KEEP_AWAKE_ITEM_IDS } from '@cairn/shared';
import type { TVars } from '../i18n/translate.js';
import { USAGE_PATH } from '../resources/hrefs.js';
import type { TrayGroup, TrayMachineState, TrayText, TrayUsage } from './tray-groups.js';

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
    const text =
      state.lastSeenAt === null
        ? t('离线')
        : t('离线 · 最后在线 {ago}', { ago: ago(state.lastSeenAt, now, t) });
    return {
      parts: [{ text, strained: false }],
      faint: true,
      spoken: text,
      tip: t('离线时读数已过期，不显示'),
    };
  }
  if (state.kind === 'unreported') {
    const text = t('尚未上报内存和负载');
    return { parts: [{ text, strained: false }], faint: true, spoken: text, tip: text };
  }
  const mem = Math.round((state.memory ?? 0) * 100);
  const load = state.load.toFixed(1);
  const loadText = t('负载 {load} / {cores} 核', { load, cores: state.cores });
  const parts: Reading['parts'] = [];
  if (state.memory !== null) {
    parts.push({ text: t('内存 {mem}%', { mem }), strained: state.strain.includes('memory') });
  }
  const cpu = state.cpu === null ? null : Math.round(state.cpu * 100);
  if (cpu !== null) parts.push({ text: `CPU ${cpu}%`, strained: state.strain.includes('cpu') });
  parts.push({ text: loadText, strained: false });
  if (state.strain.includes('disk')) {
    parts.push({ text: t('剩余磁盘 {disk} GB', { disk: state.diskGb }), strained: true });
  }
  const tip =
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
        });
  const spoken = [
    ...state.strain.map((reason) => t(STRAIN_WORD[reason])),
    ...parts.map((p) => p.text),
  ].join(', ');
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
  const items: NativeTrayItem[] = [
    {
      kind: 'row',
      id: 'coordinator',
      title: 'Coordinator',
      image: 'brand',
      ...(coordinatorBusy ? { status: t('正在回复') } : {}),
      open: { kind: 'path', path: '/app' },
    },
  ];
  if (!groups.some((group) => group.rows.length > 0)) {
    items.push({ kind: 'row', id: 'empty', title: t('没有等你的事') });
  }
  for (const group of groups) {
    items.push({
      kind: 'header',
      id: group.key,
      title: group.literal ? group.label : t(group.label),
      ...(group.machine === undefined ? {} : { reading: machineReading(group.machine, now, t) }),
    });
    for (const row of group.rows) {
      items.push({
        kind: 'row',
        id: `${group.key}/${row.key}`,
        title: row.note === undefined ? row.title : say(row.note),
        ...(row.note === undefined ? { glyph: row.glyph } : {}),
        ...(row.hint === undefined ? {} : { status: say(row.hint) }),
        ...(row.tip === undefined ? {} : { tip: say(row.tip) }),
        ...(row.warn === true ? { warn: true } : {}),
        open: { kind: 'path', path: row.path },
      });
    }
  }
  if (usage !== null) {
    items.push({ kind: 'separator', id: 'usage-rule' });
    items.push({
      kind: 'row',
      id: 'usage',
      title: t('今天用了 {tokens} tokens', { tokens: usage.tokens }),
      image: 'usage',
      ...(usage.quota === null ? {} : { status: say(usage.quota) }),
      open: { kind: 'path', path: USAGE_PATH },
    });
  }
  const runner = state?.runner ?? 'starting';
  const storedMode = state?.keepAwake ?? 'system';
  const lidClosedAvailable = state?.lidClosedAvailable ?? false;
  const effectiveMode = storedMode === 'lid-closed' && !lidClosedAvailable ? 'system' : storedMode;
  const choice = (mode: keyof typeof KEEP_AWAKE_ITEM_IDS, title: string): NativeTrayItem => ({
    kind: 'choice',
    id: KEEP_AWAKE_ITEM_IDS[mode],
    title,
    on: state !== null && effectiveMode === mode,
    enabled: state !== null,
  });
  items.push(
    { kind: 'separator', id: 'controls-rule' },
    {
      kind: 'switch',
      id: 'runner',
      title: t('本机执行机'),
      detail: t(RUNNER_WORD[runner]),
      ...(runner === 'failed' ? { warn: true } : {}),
      on: runner === 'on' || runner === 'starting',
      enabled: state !== null && runner !== 'starting',
    },
    { kind: 'header', id: 'keep-awake-title', title: t('有任务运行时保持唤醒') },
    choice('screen-on', t('屏幕常亮')),
    choice('system', t('屏幕可熄灭')),
    ...(lidClosedAvailable ? [choice('lid-closed', t('合盖继续运行'))] : []),
    { kind: 'command', id: 'settings', title: t('设置'), key: ',' },
    { kind: 'separator', id: 'account-rule' },
    { kind: 'row', id: 'user', title: userName, image: 'user' },
    { kind: 'command', id: 'quit', title: t('退出 Cairn'), key: 'q' },
  );
  return { label: 'Cairn', items };
}
