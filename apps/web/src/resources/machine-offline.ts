import { relativeTime } from '../board/rel-time.js';
import type { TFunc } from '../i18n/translate.js';

export interface OfflineGuidance {
  lastSeen: string | null;
  recovery: string;
}

export function offlineGuidance(
  machine: { online?: boolean; lastSeenAt?: number | null },
  now: number,
  command: string,
  t: TFunc,
): OfflineGuidance | null {
  if (machine.online !== false) return null;
  return {
    lastSeen:
      relativeTime(machine.lastSeenAt, now, t) === ''
        ? null
        : t('最后在线 {time}', { time: relativeTime(machine.lastSeenAt, now, t) }),
    recovery: t(
      '在这台 Runner 上确认它已联网、没有休眠，然后运行 `{command}` 重新启动。上线后这里会自动变回在线。',
      { command },
    ),
  };
}
