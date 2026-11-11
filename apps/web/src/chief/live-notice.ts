import type { ChiefStreamItem } from '../fixtures/records.js';

const NOTICE_LABEL_PREFIXES = ['排队中', '等额度'];
const NOTICE_LABELS = new Set(['正在连接 {machine}...', '正在停止…']);

export function isLiveNotice(
  label: string,
  labelDetail?: Extract<ChiefStreamItem, { kind: 'streaming' }>['labelDetail'],
): boolean {
  return (
    labelDetail !== undefined ||
    NOTICE_LABELS.has(label) ||
    NOTICE_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix))
  );
}
