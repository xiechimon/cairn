const NOTICE_LABEL_PREFIXES = ['排队中', '等额度'];
const NOTICE_LABELS = new Set(['正在连接 {machine}...', '正在停止…']);

export function isLiveNotice(label: string): boolean {
  return (
    NOTICE_LABELS.has(label) || NOTICE_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix))
  );
}
