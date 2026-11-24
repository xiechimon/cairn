import type {
  DesktopRunnerState,
  DesktopTrayState,
  NativeTrayItem,
  NativeTrayMenu,
} from '@cairn/shared';
import type { TVars } from '../i18n/translate.js';
import { USAGE_PATH } from '../resources/hrefs.js';
import type { TrayGroup, TrayText, TrayUsage } from './tray-groups.js';

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
  t: Translate;
}

function osOf(group: TrayGroup): 'darwin' | 'windows' | 'linux' | 'unknown' {
  const platform = group.os?.osPlatform;
  return platform === 'darwin' || platform === 'windows' || platform === 'linux'
    ? platform
    : 'unknown';
}

export function trayMenuModel({
  groups,
  usage,
  coordinatorBusy,
  state,
  userName,
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
  for (const group of groups) {
    const machine = group.literal === true;
    items.push({
      kind: 'header',
      id: group.key,
      title: group.literal ? group.label : t(group.label),
      ...(machine ? { os: osOf(group) } : {}),
      ...(group.meta === undefined
        ? {}
        : {
            meter: {
              percent: group.meta.percent,
              level: group.meta.level,
              tip: say(group.meta.tip),
            },
          }),
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
  if (groups.length === 0) items.push({ kind: 'row', id: 'empty', title: t('没有等你的事') });
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
    {
      kind: 'switch',
      id: 'keep-awake',
      title: t('保持屏幕常亮'),
      on: state?.keepAwake ?? false,
      enabled: state !== null,
    },
    { kind: 'command', id: 'settings', title: t('设置'), key: ',' },
    { kind: 'separator', id: 'account-rule' },
    { kind: 'row', id: 'user', title: userName, image: 'user' },
    { kind: 'command', id: 'quit', title: t('退出 Cairn'), key: 'q' },
  );
  return { label: 'Cairn', items };
}
