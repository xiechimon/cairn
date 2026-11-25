import type { MachineRow } from '../src/fixtures/records.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/provider.js';
import { useOwnComputerRow } from '../src/resources/own-computer-panel.js';

vi.mock('../src/api/provider.js', () => ({
  useLiveData: () => ({
    live: true,
    teamId: 't1',
    userName: 'Owner',
    user: { displayName: 'Owner', avatarUrl: null },
    teamsQuery: undefined,
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

function OwnComputerHarness({ machine }: { machine: MachineRow }) {
  const row = useOwnComputerRow(machine);
  return createElement('div', null, row.meta, row.drawer);
}

const MAC_NEEDING_ACCESS: MachineRow = {
  id: 'm-mac',
  name: 'Mac mini',
  kind: 'local',
  online: true,
  version: '0.1.730',
  capabilities: {
    ownComputer: true,
    osPlatform: 'darwin',
    hostPermissions: {
      accessibility: 'denied',
      screenRecording: 'granted',
    },
  },
  stepsLast24h: 0,
  lastSeenAt: 1,
};

describe('own-computer panel host boundary', () => {
  it('hides Mac permission IPC buttons and shows local-Mac guidance when connected in remote mode', () => {
    (globalThis as { window?: unknown }).window = {
      cairnDesktop: {
        ownComputer: {
          guide: async () => true,
          permissions: async () => ({ accessibility: 'denied', screenRecording: 'granted' }),
        },
        host: {
          status: async () => ({
            activeId: 'remote-mini',
            activeKind: 'remote',
            activeName: 'Mac mini',
            resident: false,
            residentSupported: false,
            items: [],
          }),
          subscribe: () => () => {},
        },
      },
    };

    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(OwnComputerHarness, { machine: MAC_NEEDING_ACCESS }),
      }),
    );
    expect(html).toContain('data-testid="own-computer-browser-hint"');
    expect(html).toContain('请在这台 Mac 的 Cairn 桌面应用里完成权限授权与检查。');
    expect(html).not.toContain('data-testid="own-computer-guide"');
    expect(html).not.toContain('data-testid="own-computer-recheck"');
  });
});
