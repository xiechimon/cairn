import type { MachinePhoneReport, PhoneRow } from '@cairn/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MachineRow } from '../src/fixtures/records.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { orderMachines } from '../src/resources/machine-order.js';
import { mergePhoneViews } from '../src/resources/phone-views.js';
import { MachinePhoneRows } from '../src/resources/phones-panel.js';

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
      {
        deviceId: 'android:aaaa1111bbbb2222',
        platform: 'android',
        name: 'Pixel 8a',
        link: 'ready',
      },
      { deviceId: 'dev-seen', platform: 'android', name: '新手机', link: 'seen' },
      { deviceId: 'dev-ghost', platform: 'android', name: '离线未配对手机', link: 'offline' },
      {
        deviceId: 'android:cccc3333dddd4444',
        platform: 'android',
        name: '旧手机',
        link: 'offline',
      },
    ];
    const rows: PhoneRow[] = [
      phone('p1', 'android:aaaa1111bbbb2222', 'Pixel 8a'),
      phone('p2', 'android:cccc3333dddd4444', '旧手机'),
    ];
    const views = mergePhoneViews(reported, rows);
    expect(views.map((view) => [view.deviceId, view.state])).toEqual([
      ['android:aaaa1111bbbb2222', 'ready'],
      ['dev-seen', 'not_paired'],
      ['android:cccc3333dddd4444', 'unreachable'],
    ]);
  });

  it('presents an endpoint-keyed paired row as needing explicit re-pairing', () => {
    const rows: PhoneRow[] = [phone('p-legacy', '192.168.1.20:42155', '旧手机')];
    const views = mergePhoneViews(
      [
        {
          deviceId: '192.168.1.20:42155',
          platform: 'android',
          name: '旧手机',
          link: 'ready',
        },
      ],
      rows,
    );
    expect(views[0]?.state).toBe('re_pair');
  });

  it('uses one unambiguous unauthorized transport as the re-pair hint for the one missing paired row', () => {
    const rows: PhoneRow[] = [phone('p1', 'android:abcdef1234567890', 'Pixel 8a')];
    const views = mergePhoneViews(
      [
        {
          deviceId: '192.168.1.20:42155',
          platform: 'android',
          name: 'Pixel 8a',
          link: 'unauthorized',
        },
      ],
      rows,
    );
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ deviceId: 'android:abcdef1234567890', state: 're_pair' });
  });

  it('does not present an unauthorized phone as pairing unless a pair call is running', () => {
    const rows: PhoneRow[] = [phone('p1', 'android:abcdef1234567890', 'USB 手机')];
    const unauthorized = mergePhoneViews(
      [
        {
          deviceId: 'android:abcdef1234567890',
          platform: 'android',
          name: 'USB 手机',
          link: 'unauthorized',
        },
      ],
      rows,
    );
    expect(unauthorized[0]?.state).toBe('re_pair');
    const pairing = mergePhoneViews(
      [
        {
          deviceId: 'android:abcdef1234567890',
          platform: 'android',
          name: 'USB 手机',
          link: 'unauthorized',
        },
      ],
      [{ ...rows[0]!, pairing: true }],
    );
    expect(pairing[0]?.state).toBe('pairing');
  });
});

function renderPhoneRows(machine: MachineRow): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(MachinePhoneRows, { machine, onOpenPair: () => {} }),
      }),
    ),
  );
}

describe('MachinePhoneRows self-explanatory rendering', () => {
  it('renders nothing when a hostable Mac has no paired or discovered phones', () => {
    const html = renderPhoneRows(
      row('local-mac', {
        kind: 'local',
        online: true,
        capabilities: { mcpServers: [], skills: [], osPlatform: 'darwin', phones: [] },
        phonesFixture: { phones: [] },
      }),
    );
    expect(html).toBe('');
  });

  it('shows phone kind, agent capability, and state on each phone row', () => {
    const html = renderPhoneRows(
      row('m-1', {
        kind: 'local',
        online: true,
        capabilities: {
          mcpServers: [],
          skills: [],
          osPlatform: 'darwin',
          phones: [
            {
              deviceId: 'android:aaaa1111bbbb2222',
              platform: 'android',
              name: 'Pixel 8a',
              link: 'ready',
            },
            {
              deviceId: '192.168.1.33:5555',
              platform: 'android',
              name: 'Pixel 7',
              link: 'seen',
            },
          ],
        },
        phonesFixture: { phones: [phone('p1', 'android:aaaa1111bbbb2222', 'Pixel 8a')] },
      }),
    );
    expect(html).toContain('data-testid="phone-kind"');
    expect(html).toContain('安卓手机');
    expect(html).toContain('data-testid="phone-capability"');
    expect(html).toContain('Agent 可查看和操作');
    expect(html).toContain('配对后可供 Agent 查看和操作');
    expect(html).toContain('就绪');
    expect(html).toContain('未配对');
  });

  it('suppresses discovered phones reported by remote runners', () => {
    const html = renderPhoneRows(
      row('remote-mac', {
        kind: 'remote',
        online: true,
        capabilities: {
          mcpServers: [],
          skills: [],
          osPlatform: 'darwin',
          phones: [
            {
              deviceId: 'emulator-5554',
              platform: 'android',
              name: 'sdk gphone64 arm64',
              link: 'seen',
            },
          ],
        },
        phonesFixture: { phones: [] },
      }),
    );
    expect(html).toBe('');
  });
});
