import type { MachinePhoneReport, PhoneRow } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import type { MachineRow } from '../src/fixtures/records.js';
import { orderMachines } from '../src/resources/machine-order.js';
import { mergePhoneViews } from '../src/resources/phone-views.js';

function row(id: string, patch: Partial<MachineRow> = {}): MachineRow {
  return {
    id,
    kind: 'remote',
    name: id,
    online: true,
    ...patch,
  };
}

function phone(id: string, deviceId: string, name: string): PhoneRow {
  return {
    id,
    machineId: 'm-1',
    platform: 'android',
    deviceId,
    name,
    consented: true,
    pairing: false,
    busy: false,
    handoff: false,
    lastError: null,
    createdAt: 1,
  };
}

describe('orderMachines', () => {
  it('places the default runner first, then online runners, then offline runners', () => {
    const input = [
      row('local-mac', { kind: 'local', online: true }),
      row('stale-dup', { online: false }),
      row('mac-mini', { online: true }),
      row('linux-box', { online: true }),
      row('old-laptop', { online: false }),
    ];
    expect(orderMachines(input, 'mac-mini').map((m) => m.id)).toEqual([
      'mac-mini',
      'local-mac',
      'linux-box',
      'stale-dup',
      'old-laptop',
    ]);
  });

  it('keeps an offline default runner first ahead of online runners', () => {
    const input = [
      row('online-a', { online: true }),
      row('offline-default', { online: false }),
      row('online-b', { online: true }),
    ];
    expect(orderMachines(input, 'offline-default').map((m) => m.id)).toEqual([
      'offline-default',
      'online-a',
      'online-b',
    ]);
  });

  it('preserves relative order within online and offline tiers when no default is set', () => {
    const input = [
      row('off-1', { online: false }),
      row('on-1', { kind: 'local', online: true }),
      row('off-2', { online: false }),
      row('on-2', { online: true }),
    ];
    expect(orderMachines(input, null).map((m) => m.id)).toEqual([
      'on-1',
      'on-2',
      'off-1',
      'off-2',
    ]);
  });
});

describe('mergePhoneViews', () => {
  it('omits unpaired offline probes while keeping paired offline phones and live discoveries', () => {
    const reported: MachinePhoneReport[] = [
      { deviceId: 'dev-ready', platform: 'android', name: 'Pixel 8a', link: 'ready' },
      { deviceId: 'dev-seen', platform: 'android', name: '新手机', link: 'seen' },
      { deviceId: 'dev-ghost', platform: 'android', name: '离线未配对手机', link: 'offline' },
      { deviceId: 'dev-paired-off', platform: 'android', name: '旧手机', link: 'offline' },
    ];
    const rows: PhoneRow[] = [
      phone('p1', 'dev-ready', 'Pixel 8a'),
      phone('p2', 'dev-paired-off', '旧手机'),
    ];
    const views = mergePhoneViews(reported, rows);
    expect(views.map((view) => [view.deviceId, view.state])).toEqual([
      ['dev-ready', 'ready'],
      ['dev-seen', 'not_paired'],
      ['dev-paired-off', 'unreachable'],
    ]);
  });
});
