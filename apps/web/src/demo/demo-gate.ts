import { toast } from 'sonner';
import { EN } from '../i18n/en.js';
import { readStoredLocale } from '../i18n/locale.js';
import { translate } from '../i18n/translate.js';
import { safeLocalStorage } from '../safe-storage.js';

export const DEMO_MODE: boolean = import.meta.env.MODE === 'demo';

export const DEMO_WRITE_BLOCKED_ZH = '这是演示数据，改动不会保存';

export function blockDemoWrite(): boolean {
  if (!DEMO_MODE) return false;
  toast(translate(readStoredLocale(safeLocalStorage()), EN, DEMO_WRITE_BLOCKED_ZH));
  return true;
}
