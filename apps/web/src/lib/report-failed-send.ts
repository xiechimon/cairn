import { toastError } from '../components/ui/toaster.js';
import { EN } from '../i18n/en.js';
import { activeLocale } from '../i18n/locale.js';
import { translate } from '../i18n/translate.js';
import { errorWasSurfaced } from './mutation-error-report.js';

export function reportFailedSend(error: unknown, shownReason: unknown): void {
  console.error('cairn: send failed', error);
  if (!errorWasSurfaced(error))
    toastError(translate(activeLocale(), EN, '发送失败，请重试。'), shownReason);
}
