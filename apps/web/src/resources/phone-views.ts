import type { MachinePhoneReport, PhoneRow } from '@cairn/shared';

export type PhoneViewState =
  | 'not_paired'
  | 'pairing'
  | 'ready'
  | 'busy'
  | 'locked'
  | 'handoff'
  | 'unreachable'
  | 'signing_expired';

export interface PhoneView {
  key: string;
  deviceId: string;
  name: string;
  row: PhoneRow | null;
  link: MachinePhoneReport['link'] | null;
  state: PhoneViewState;
}

function viewOf(row: PhoneRow | null, link: MachinePhoneReport['link'] | null): PhoneViewState {
  if (row === null) return 'not_paired';
  if (row.handoff) return 'handoff';
  if (row.pairing || link === 'seen' || link === 'unauthorized') return 'pairing';
  if (link === 'ready') return row.busy ? 'busy' : 'ready';
  if (link === 'locked') return 'locked';
  if (link === 'signing_expired') return 'signing_expired';
  return 'unreachable';
}

export function mergePhoneViews(
  reported: readonly MachinePhoneReport[],
  rows: readonly PhoneRow[],
): PhoneView[] {
  const views = new Map<string, PhoneView>();
  for (const phone of reported) {
    const row = rows.find((entry) => entry.deviceId === phone.deviceId) ?? null;
    if (row === null && phone.link === 'offline') continue;
    views.set(phone.deviceId, {
      key: phone.deviceId,
      deviceId: phone.deviceId,
      name: row?.name ?? phone.name,
      row,
      link: phone.link,
      state: viewOf(row, phone.link),
    });
  }
  for (const row of rows) {
    if (views.has(row.deviceId)) continue;
    views.set(row.deviceId, {
      key: row.deviceId,
      deviceId: row.deviceId,
      name: row.name,
      row,
      link: null,
      state: viewOf(row, null),
    });
  }
  return [...views.values()];
}
