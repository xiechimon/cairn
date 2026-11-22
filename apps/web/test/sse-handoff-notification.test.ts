import { notificationRecordSchema } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { startTeamStream } from '../src/api/sse.js';
import { EN } from '../src/i18n/en.js';
import type { Locale } from '../src/i18n/locale.js';

vi.mock('../src/pwa/push-device.js', () => ({ canDeliverNotifications: () => true }));

const CJK = /[一-鿿]/;

let receive: ((event: { data: string }) => void) | null = null;
let disconnect: (() => void) | undefined;

afterEach(() => {
  disconnect?.();
  disconnect = undefined;
  receive = null;
  vi.unstubAllGlobals();
});

function storedLocale(locale: Locale) {
  const map = new Map<string, string>([
    ['cairn.locale', locale],
    ['cairn-locale', locale],
  ]);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

async function handoffTitle(locale: Locale): Promise<string> {
  const shown = vi.fn();
  class DesktopNotification {
    static permission = 'granted';
    constructor(title: string, options: NotificationOptions) {
      shown(title, options);
    }
  }
  class Source {
    static OPEN = 1;
    readyState = 1;
    set onmessage(handler: (event: { data: string }) => void) {
      receive = handler;
    }
    close() {}
  }
  vi.stubGlobal('EventSource', Source);
  vi.stubGlobal('document', { hidden: true });
  vi.stubGlobal('window', { localStorage: storedLocale(locale), location: { pathname: '/app' } });
  vi.stubGlobal('navigator', { language: locale === 'zh' ? 'zh-CN' : 'en-US' });
  vi.stubGlobal('Notification', DesktopNotification);
  const record = {
    id: 'user:todo', teamId: 'team', userId: 'user', type: 'coordinator_handoff',
    entityId: 'todo', entityRef: { title: 'Repair CI', projectId: 'project', seqNum: 1 },
    agent: { name: 'Owner', avatarUrl: null }, snippet: null, readAt: null,
    createdAt: Date.now(), channels: ['in_app'],
  };
  expect(notificationRecordSchema.safeParse(record).success).toBe(true);
  disconnect = startTeamStream('team', new QueryClient());
  receive?.({ data: JSON.stringify({ type: 'notification', notification: record }) });
  await vi.waitFor(() => expect(shown).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: 'Repair CI' })));
  return shown.mock.calls[0]?.[0] as string;
}

test('a handoff reaches the desktop as a decision rather than a build review', async () => {
  expect(await handoffTitle('zh')).toBe('需要你决定');
});

test('the handoff notification title is English on an English desktop', async () => {
  const title = await handoffTitle('en');
  expect(CJK.test(title)).toBe(false);
  expect(title).toBe(EN['需要你决定']);
});
