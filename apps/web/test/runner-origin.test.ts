import { expect, test } from 'vitest';
import { screenControlStatus } from '../src/board/screen-control.js';
import { resolveRunnerServerUrl } from '../src/resources/create-machine-dialog.js';

const identityT = (key: string) => key;

test('screenControlStatus reports handback failure distinctly from takeover failure', () => {
  expect(
    screenControlStatus(
      {
        leaseId: 'lease-1',
        busy: false,
        failed: true,
        failedAction: 'release',
        controlHeld: true,
        setHeld: () => {},
      },
      true,
      identityT,
    ),
  ).toBe('交还失败，请重试。');

  expect(
    screenControlStatus(
      {
        leaseId: null,
        busy: false,
        failed: true,
        failedAction: 'acquire',
        controlHeld: false,
        setHeld: () => {},
      },
      false,
      identityT,
    ),
  ).toBe('未能接管，电脑没有响应');
});

test('resolveRunnerServerUrl aggregates tailscale, public, tsnet, non-loopback page origin, and lan routes', () => {
  expect(
    resolveRunnerServerUrl({
      tailscale: { state: 'ready', url: 'https://studio.tail1234.ts.net', consentUrl: null },
      routes: [{ kind: 'public', url: 'https://cairn.example.com' }],
      pageOrigin: 'http://127.0.0.1:8787',
    }),
  ).toEqual({ url: 'https://studio.tail1234.ts.net', source: 'tailscale' });

  expect(
    resolveRunnerServerUrl({
      tailscale: { state: 'not-installed', url: null, consentUrl: null },
      routes: [{ kind: 'public', url: 'https://cairn.example.com' }],
      pageOrigin: 'http://127.0.0.1:8787',
    }),
  ).toEqual({ url: 'https://cairn.example.com', source: 'public' });

  expect(
    resolveRunnerServerUrl({
      tailscale: { state: 'not-installed', url: null, consentUrl: null },
      routes: [{ kind: 'tailnet', url: 'https://box.tail1234.ts.net' }],
      pageOrigin: 'http://localhost:8787',
    }),
  ).toEqual({ url: 'https://box.tail1234.ts.net', source: 'tailnet' });

  expect(
    resolveRunnerServerUrl({
      tailscale: { state: 'not-installed', url: null, consentUrl: null },
      routes: [],
      pageOrigin: 'https://selfhosted.example.com/app/machines/authorize',
    }),
  ).toEqual({ url: 'https://selfhosted.example.com', source: 'page' });

  expect(
    resolveRunnerServerUrl({
      tailscale: { state: 'not-connected', url: null, consentUrl: null },
      routes: [{ kind: 'lan', url: 'http://192.168.1.20:8787' }],
      pageOrigin: 'http://127.0.0.1:8787',
    }),
  ).toEqual({ url: 'http://192.168.1.20:8787', source: 'lan' });

  expect(
    resolveRunnerServerUrl({
      tailscale: { state: 'not-connected', url: null, consentUrl: null },
      routes: [],
      pageOrigin: 'http://127.0.0.1:8787',
    }),
  ).toBeNull();
});
