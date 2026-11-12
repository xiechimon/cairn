import { toastError, toastSuccess } from '../components/ui/toaster.js';
import type { TFunc } from '../i18n/translate.js';

export function toastArchived(
  t: TFunc,
  title: string,
  unarchive: (handlers: { onError: (error: unknown) => void }) => void,
): void {
  toastSuccess(t('已归档「{title}」', { title }), {
    label: t('撤销'),
    onClick: () => unarchive({ onError: (error) => toastError(t('无法撤销归档。'), error) }),
  });
}
