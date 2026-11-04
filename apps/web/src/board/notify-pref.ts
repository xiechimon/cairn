export const NOTIFY_PREF_KEY = 'cairn.notifyEnabled';

export type NotifyPref = 'on' | 'off';

export function readNotifyPref(storage: Pick<Storage, 'getItem'> | null): NotifyPref | null {
  let value: string | null = null;
  try {
    value = storage?.getItem(NOTIFY_PREF_KEY) ?? null;
  } catch {
    return null;
  }
  if (value === '1') return 'on';
  if (value === '0') return 'off';
  return null;
}

export function persistNotifyPref(
  pref: NotifyPref,
  storage: Pick<Storage, 'setItem'> | null,
): void {
  try {
    storage?.setItem(NOTIFY_PREF_KEY, pref === 'on' ? '1' : '0');
  } catch {}
}
