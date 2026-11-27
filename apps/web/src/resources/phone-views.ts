import type { MachinePhoneReport, PhoneRow } from '@cairn/shared';

export type PhoneViewState =
  | 'not_paired'
  | 'pairing'
  | 'ready'
  | 'busy'
  | 'locked'
  | 'handoff'
  | 'unreachable'
  | 're_pair'
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
  if (row.pairing) return 'pairing';
  if (!row.deviceId.startsWith('android:')) return 're_pair';
  if (link === 'unauthorized') return 're_pair';
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
  const rowlessUnauthorized: string[] = [];
  for (const phone of reported) {
    const row = rows.find((entry) => entry.deviceId === phone.deviceId) ?? null;
    if (row === null && phone.link === 'offline') continue;
    if (row === null && phone.link === 'unauthorized') rowlessUnauthorized.push(phone.deviceId);
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
  if (rowlessUnauthorized.length === 1) {
    const missing = rows.filter(
      (row) =>
        row.deviceId.startsWith('android:') &&
        views.get(row.deviceId)?.link === null &&
        views.get(row.deviceId)?.state === 'unreachable',
    );
    if (missing.length === 1) {
      views.delete(rowlessUnauthorized[0]!);
      const view = views.get(missing[0]!.deviceId);
      if (view !== undefined) view.state = 're_pair';
    }
  }
  return [...views.values()];
}
