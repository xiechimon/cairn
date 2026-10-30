import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import { openDbWithHandle } from '../src/db/client.js';
import { pushDelivery, pushDigestItem, pushSubscription } from '../src/db/schema.js';
import { queuePushDigest, sendPushToUser, sweepPushDigest } from '../src/services/push.js';
import { sendMustReachAlert, sweepPendingPushAlerts } from '../src/services/push-alerts.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, req } from './helpers.js';

const message = { title: 'test: batch paused', body: 'Paused', href: '/app', tag: 'test' };
const accepted = { statusCode: 201, body: '', headers: {} };
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(count = 1) {
  const s = bootServer();
  for (let i = 0; i < count; i++)
    s.db
      .insert(pushSubscription)
      .values({
        id: `sub-${i}`,
        userId: s.user.id,
        teamId: s.team.id,
        endpoint: `https://fcm.googleapis.com/${i}`,
        p256dh: 'p',
        auth: 'a',
        createdAt: 0,
      })
      .run();
  if (!s.vapidKeys) throw new Error('Missing test keys');
  return { ...s, keys: s.vapidKeys };
}

test('empty subscriptions return no-subscription', async () => {
  const s = setup(0);
  expect(await sendPushToUser(s.db, s.keys, s.user.id, s.team.id, message)).toMatchObject({
    status: 'no-subscription',
  });
});

test.each([404, 410])('all %s subscriptions are removed and return all-expired', async (status) => {
  const s = setup();
  vi.spyOn(webpush, 'sendNotification').mockRejectedValue(
    new webpush.WebPushError('gone', status, {}, '', ''),
  );
  expect(await sendPushToUser(s.db, s.keys, s.user.id, s.team.id, message)).toMatchObject({
    status: 'all-expired',
  });
  expect(s.db.select().from(pushSubscription).all()).toEqual([]);
});

test('provider acceptance counts devices and correlates wire id with persistent row', async () => {
  const s = setup(2);
  const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue(accepted);
  const result = await sendPushToUser(s.db, s.keys, s.user.id, s.team.id, message, {
    id: 'receipt-test',
    required: true,
  });
  expect(result).toMatchObject({ status: 'delivered', count: 2 });
  const payload = JSON.parse(String(send.mock.calls[0]?.[1]));
  expect(payload.id).toEqual(expect.any(String));
  expect(payload.web_push).toBe(8030);
  expect(payload.mutable).toBe(true);
  expect(payload.requireReceipt).toBe(true);
  expect(s.db.select().from(pushDelivery).get()?.id).toBe(payload.id);
  console.info(
    'Push wire/database artifact',
    JSON.stringify({ payload, outcome: result, row: s.db.select().from(pushDelivery).get() }),
  );
});

test.each(['network', 'mixed'])(
  'every non-expired delivery failing returns failed: %s',
  async (mode) => {
    const s = setup(2);
    const send = vi.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('network'));
    if (mode === 'mixed')
      send.mockRejectedValueOnce(new webpush.WebPushError('gone', 410, {}, '', ''));
    expect(await sendPushToUser(s.db, s.keys, s.user.id, s.team.id, message)).toMatchObject({
      status: 'failed',
    });
  },
);

test('one accepted device wins over failures', async () => {
  const s = setup(2);
  vi.spyOn(webpush, 'sendNotification')
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(accepted);
  expect(await sendPushToUser(s.db, s.keys, s.user.id, s.team.id, message)).toMatchObject({
    status: 'delivered',
    count: 1,
  });
});

test('receipt route authenticates, validates ownership and stores id idempotently', async () => {
  const s = setup();
  vi.spyOn(webpush, 'sendNotification').mockResolvedValue(accepted);
  await sendPushToUser(s.db, s.keys, s.user.id, s.team.id, message, {
    id: 'receipt-test',
    required: true,
  });
  const row = s.db.select().from(pushDelivery).get();
  if (!row) throw new Error('Missing delivery');
  const path = `/api/teams/${s.team.id}/push/receipts`;
  expect((await req(s.app, 'POST', path, { id: row.id })).status).toBe(200);
  const receivedAt = s.db.select().from(pushDelivery).get()?.receivedAt;
  expect(receivedAt).toEqual(expect.any(Number));
  console.info('Receipt database artifact', JSON.stringify(s.db.select().from(pushDelivery).get()));
  expect((await req(s.app, 'POST', path, { id: row.id })).status).toBe(200);
  expect(s.db.select().from(pushDelivery).get()?.receivedAt).toBe(receivedAt);
  s.db.update(pushDelivery).set({ userId: 'other' }).where(eq(pushDelivery.id, row.id)).run();
  expect((await req(s.app, 'POST', path, { id: row.id })).status).toBe(404);
  expect((await req(s.app, 'POST', path, { id: '' })).status).toBe(400);
  expect((await req(s.app, 'POST', '/api/teams/other/push/receipts', { id: row.id })).status).toBe(
    404,
  );
  const locked = bootServer({ authToken: 'secret' });
  expect(
    (await req(locked.app, 'POST', `/api/teams/${locked.team.id}/push/receipts`, { id: row.id }))
      .status,
  ).toBe(401);
});

test.each(['timeout', 'receipt', 'early'])('must-reach alert receipt timing: %s', async (mode) => {
  const s = setup();
  vi.useFakeTimers();
  vi.spyOn(webpush, 'sendNotification').mockImplementation(async (_sub, payload) => {
    if (mode === 'early')
      await req(s.app, 'POST', `/api/teams/${s.team.id}/push/receipts`, {
        id: JSON.parse(String(payload)).id,
      });
    return accepted;
  });
  const fallback = { send: vi.fn().mockResolvedValue(undefined) };
  const pending = sendMustReachAlert(s.db, s.keys, s.user.id, s.team.id, message, fallback);
  await vi.advanceTimersByTimeAsync(0);
  const row = s.db.select().from(pushDelivery).get();
  if (!row) throw new Error('Missing delivery');
  if (mode === 'receipt')
    await req(s.app, 'POST', `/api/teams/${s.team.id}/push/receipts`, { id: row.id });
  await vi.advanceTimersByTimeAsync(599_999);
  expect(fallback.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(fallback.send).toHaveBeenCalledTimes(mode === 'timeout' ? 1 : 0);
});

test.each(['missing', 'rejected', 'disabled'])(
  'unavailable fallback is persistently undelivered: %s',
  async (mode) => {
    const s = setup(0);
    const loud = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const fallback =
      mode === 'rejected' ? { send: vi.fn().mockRejectedValue(new Error('SMTP down')) } : null;
    const result = await sendMustReachAlert(
      s.db,
      mode === 'disabled' ? null : s.keys,
      s.user.id,
      s.team.id,
      message,
      fallback,
    );
    expect(result.alertStatus).toBe('undelivered');
    expect(s.db.select().from(pushDelivery).get()?.alertStatus).toBe('undelivered');
    expect(loud).toHaveBeenCalledWith(expect.stringContaining('UNDELIVERED'));
  },
);

test('test route returns an id before provider settlement and status is owner scoped', async () => {
  const s = setup();
  vi.useFakeTimers();
  vi.spyOn(webpush, 'sendNotification').mockImplementation(() => new Promise(() => {}));
  const path = `/api/teams/${s.team.id}/push/test`;
  expect((await req(s.app, 'POST', path, { userId: 'other' })).status).toBe(404);
  const response = await req(s.app, 'POST', path, { userId: s.user.id });
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as { id: string };
  expect(typeof id).toBe('string');
  expect(await (await req(s.app, 'GET', `${path}/${id}`)).json()).toMatchObject({
    alertStatus: 'pending',
  });
  expect((await req(s.app, 'GET', `${path}/missing`)).status).toBe(404);
  s.db.update(pushDelivery).set({ userId: 'other' }).where(eq(pushDelivery.id, id)).run();
  expect((await req(s.app, 'GET', `${path}/${id}`)).status).toBe(404);
  await vi.advanceTimersByTimeAsync(10_000);
});

test.each(['empty', 'expired', 'network', 'misconfigured'])(
  'must-reach failure invokes fallback immediately: %s',
  async (mode) => {
    const s = setup(mode === 'empty' || mode === 'misconfigured' ? 0 : 1);
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(
      mode === 'expired' ? new webpush.WebPushError('gone', 410, {}, '', '') : new Error('network'),
    );
    const fallback = { send: vi.fn().mockResolvedValue(undefined) };
    if (mode === 'misconfigured') {
      vi.stubEnv('CAIRN_ALERT_SMTP_URL', 'invalid');
      vi.stubEnv('CAIRN_ALERT_EMAIL_TO', 'owner@example.com');
      try {
        const result = await sendMustReachAlert(s.db, s.keys, s.user.id, s.team.id, message);
        expect(result.alertStatus).toBe('undelivered');
      } finally {
        vi.unstubAllEnvs();
      }
    } else {
      const result = await sendMustReachAlert(
        s.db,
        s.keys,
        s.user.id,
        s.team.id,
        message,
        fallback,
      );
      expect(result.alertStatus).toBe('fallback-accepted');
      expect(fallback.send).toHaveBeenCalledTimes(1);
    }
  },
);

test('digest retains queued items when accepted and failed subscriptions are mixed', async () => {
  const s = setup(2);
  vi.spyOn(webpush, 'sendNotification')
    .mockResolvedValueOnce(accepted)
    .mockRejectedValueOnce(new Error('network'));
  queuePushDigest(s.db, s.user.id, s.team.id, message);
  await sweepPushDigest(s.db, s.keys);
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(1);
});

test('receipt arriving after the deadline cannot suppress fallback when the event loop resumes late', async () => {
  const s = setup();
  vi.useFakeTimers();
  vi.spyOn(webpush, 'sendNotification').mockResolvedValue(accepted);
  const fallback = { send: vi.fn().mockResolvedValue(undefined) };
  const pending = sendMustReachAlert(s.db, s.keys, s.user.id, s.team.id, message, fallback);
  await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
  const id = s.db.select().from(pushDelivery).get()?.id;
  vi.setSystemTime(Date.now() + 601_000);
  await req(s.app, 'POST', `/api/teams/${s.team.id}/push/receipts`, { id });
  await vi.advanceTimersByTimeAsync(1_000);
  await pending;
  expect(fallback.send).toHaveBeenCalledTimes(1);
});

test('a provider promise that never settles cannot prevent fallback', async () => {
  const s = setup();
  vi.useFakeTimers();
  vi.spyOn(webpush, 'sendNotification').mockImplementation(() => new Promise(() => {}));
  const fallback = { send: vi.fn().mockResolvedValue(undefined) };
  const pending = sendMustReachAlert(s.db, s.keys, s.user.id, s.team.id, message, fallback);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fallback.send).toHaveBeenCalledTimes(1);
  expect(await pending).toMatchObject({
    push: { status: 'unknown' },
    alertStatus: 'fallback-accepted',
  });
});

test('ordinary pushes preserve declarative display without allocating receipt rows', async () => {
  const s = setup();
  const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue(accepted);
  await sendPushToUser(s.db, s.keys, s.user.id, s.team.id, message);
  expect(JSON.parse(String(send.mock.calls[0]?.[1]))).toMatchObject({ web_push: 8030 });
  expect(s.db.select().from(pushDelivery).all()).toEqual([]);
  expect(
    (await req(s.app, 'POST', `/api/teams/${s.team.id}/push/receipts`, { id: 'missing' })).status,
  ).toBe(404);
  expect(s.db.select().from(pushDelivery).all()).toEqual([]);
});

test.each([true, false])(
  'overdue pending rows recover without an active sender, fallback configured: %s',
  async (configured) => {
    const s = setup(0);
    s.db
      .insert(pushDelivery)
      .values({
        id: 'orphan',
        userId: s.user.id,
        teamId: s.team.id,
        createdAt: Date.now() - 600_001,
        alertStatus: 'pending',
        message,
      })
      .run();
    const fallback = { send: vi.fn().mockResolvedValue(undefined) };
    await sweepPendingPushAlerts(s.db, configured ? fallback : null);
    expect(s.db.select().from(pushDelivery).get()?.alertStatus).toBe(
      configured ? 'fallback-accepted' : 'undelivered',
    );
    expect(fallback.send).toHaveBeenCalledTimes(configured ? 1 : 0);
    await sweepPendingPushAlerts(s.db, configured ? fallback : null);
    expect(fallback.send).toHaveBeenCalledTimes(configured ? 1 : 0);
  },
);

test('pending messages survive closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'push-restart-'));
  const path = join(directory, 'test.db');
  const first = openDbWithHandle(path);
  first.db
    .insert(pushDelivery)
    .values({
      id: 'restart',
      userId: 'u',
      teamId: 't',
      message,
      createdAt: Date.now() - 600_001,
      alertStatus: 'pending',
    })
    .run();
  first.close();
  const second = openDbWithHandle(path);
  try {
    const fallback = { send: vi.fn().mockResolvedValue(undefined) };
    await sweepPendingPushAlerts(second.db, fallback);
    expect(fallback.send).toHaveBeenCalledWith(message, 'restart');
    expect(second.db.select().from(pushDelivery).get()?.alertStatus).toBe('fallback-accepted');
  } finally {
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduler recovers overdue alerts at startup and on periodic ticks', async () => {
  const s = setup(0);
  vi.useFakeTimers();
  vi.stubEnv('CAIRN_ALERT_EMAIL_TO', '');
  const insert = (id: string) =>
    s.db
      .insert(pushDelivery)
      .values({
        id,
        userId: s.user.id,
        teamId: s.team.id,
        message,
        createdAt: Date.now() - 600_001,
        alertStatus: 'pending',
      })
      .run();
  const scheduler = createScheduler(s.svc, { tickMs: 100 });
  try {
    insert('startup');
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      s.db.select().from(pushDelivery).where(eq(pushDelivery.id, 'startup')).get()?.alertStatus,
    ).toBe('undelivered');
    insert('periodic');
    await vi.advanceTimersByTimeAsync(100);
    expect(
      s.db.select().from(pushDelivery).where(eq(pushDelivery.id, 'periodic')).get()?.alertStatus,
    ).toBe('undelivered');
  } finally {
    scheduler.stop();
    vi.unstubAllEnvs();
  }
});

test('library socket timeout is unknown and still sends fallback', async () => {
  const s = setup();
  vi.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('Socket timeout'));
  const fallback = { send: vi.fn().mockResolvedValue(undefined) };
  const result = await sendMustReachAlert(s.db, s.keys, s.user.id, s.team.id, message, fallback);
  expect(result).toMatchObject({ push: { status: 'unknown' }, alertStatus: 'fallback-accepted' });
  expect(s.db.select().from(pushDelivery).get()?.pushStatus).toBe('unknown');
  expect(fallback.send).toHaveBeenCalledTimes(1);
});
