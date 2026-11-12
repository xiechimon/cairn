import { notificationRecordSchema } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { startTeamStream } from '../src/api/sse.js';

let receive: ((event: { data: string }) => void) | null = null;
let disconnect: (() => void) | undefined;

afterEach(() => {
  disconnect?.();
  vi.unstubAllGlobals();
});

test('a handoff reaches the desktop as a decision rather than a build review', async () => {
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
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('Notification', DesktopNotification);
  const record = {
    id: 'user:todo', teamId: 'team', userId: 'user', type: 'coordinator_handoff',
    entityId: 'todo', entityRef: { title: 'Repair CI', projectId: 'project', seqNum: 1 },
    agent: { name: 'Owner', avatarUrl: null }, snippet: null, readAt: null,
    createdAt: Date.now(), channels: ['in_app'],
  };
  disconnect = startTeamStream('team', new QueryClient());
  receive?.({ data: JSON.stringify({ type: 'notification', notification: record }) });
  await vi.waitFor(() => expect(shown).toHaveBeenCalledWith('需要你决定', expect.objectContaining({ body: 'Repair CI' })));
  expect(notificationRecordSchema.safeParse(record).success).toBe(true);
});
