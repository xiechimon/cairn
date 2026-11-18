import { DESKTOP_NOTIFY_SOUNDS, type DesktopNotifySound } from '@cairn/shared';

export const NOTIFY_PREF_KEY = 'cairn.notifyEnabled';
export const NOTIFY_SOUND_KEY = 'cairn.notifySound';

export type NotifyPref = 'on' | 'off';
export type NotifySound = DesktopNotifySound;

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

export function readNotifySound(storage: Pick<Storage, 'getItem'> | null): NotifySound {
  let value: string | null = null;
  try {
    value = storage?.getItem(NOTIFY_SOUND_KEY) ?? null;
  } catch {
    return 'system';
  }
  return (DESKTOP_NOTIFY_SOUNDS as readonly string[]).includes(value ?? '')
    ? (value as NotifySound)
    : 'system';
}

export function persistNotifySound(
  sound: NotifySound,
  storage: Pick<Storage, 'setItem'> | null,
): void {
  try {
    storage?.setItem(NOTIFY_SOUND_KEY, sound);
  } catch {}
}
