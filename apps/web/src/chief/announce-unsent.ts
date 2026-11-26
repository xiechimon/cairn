import { toast } from 'sonner';
import type { TFunc } from '../i18n/translate.js';
import { describeError } from '../lib/error-copy.js';
import { markErrorSurfaced } from '../lib/mutation-error-report.js';

const UNSENT_TOAST_MS = 30_000;

export function reportedByOutbox(error: unknown): never {
  markErrorSurfaced(error);
  throw error;
}

export function dismissUnsent(id: string): void {
  toast.dismiss(id);
}

export function announceUnsent(error: unknown, t: TFunc, open: () => void, id?: string): void {
  markErrorSurfaced(error);
  toast.error(t('有一条消息尚未确认发出'), {
    ...(id !== undefined ? { id } : {}),
    description: describeError(error, t) ?? t('发送失败，请重试。'),
    action: { label: t('打开对话'), onClick: open },
    duration: UNSENT_TOAST_MS,
  });
}
