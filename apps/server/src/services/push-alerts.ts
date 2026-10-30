import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pushDelivery } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { type PushMessage, type PushOutcome, sendPushToUser, type VapidKeys } from './push.js';

export interface AlertFallback {
  send(message: PushMessage, id: string): Promise<void>;
}

export function smtpAlertFallback(env: NodeJS.ProcessEnv = process.env): AlertFallback | null {
  const address = env.CAIRN_ALERT_EMAIL_TO;
  const rawUrl = env.CAIRN_ALERT_SMTP_URL;
  if (!address || !rawUrl) return null;
  const url = new URL(rawUrl);
  if (!['smtp:', 'smtps:'].includes(url.protocol) || !/^[^\s<>@]+@[^\s<>@]+$/.test(address))
    throw new Error('Invalid alert SMTP configuration');
  const from = decodeURIComponent(url.username);
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(from))
    throw new Error('SMTP URL username must be a sender email address');
  return {
    async send(message, id) {
      const config = [
        `url = ${JSON.stringify(url.href)}`,
        `mail-from = ${JSON.stringify(from)}`,
        `mail-rcpt = ${JSON.stringify(address)}`,
        'ssl-reqd',
      ].join('\n');
      const mail = [
        `From: ${from}`,
        `To: ${address}`,
        `Subject: =?UTF-8?B?${Buffer.from(message.title).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(`${message.body}\nNotification: ${id}`).toString('base64'),
        '',
      ].join('\r\n');
      const directory = mkdtempSync(join(tmpdir(), 'cairn-alert-mail-'));
      const mailPath = join(directory, 'message.eml');
      try {
        writeFileSync(mailPath, mail, { mode: 0o600 });
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            'curl',
            [
              '--disable',
              '--silent',
              '--show-error',
              '--max-time',
              '30',
              '--config',
              '-',
              '--upload-file',
              mailPath,
            ],
            { stdio: ['pipe', 'ignore', 'ignore'] },
          );
          child.once('error', () => reject(new Error('SMTP transport unavailable')));
          child.once('close', (code) =>
            code === 0 ? resolve() : reject(new Error('SMTP delivery failed')),
          );
          child.stdin.on('error', () => {});
          child.stdin.end(config);
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

const fallbackInFlight = new WeakMap<
  Db,
  Map<string, Promise<'fallback-accepted' | 'undelivered'>>
>();

async function settleFallback(
  db: Db,
  id: string,
  message: PushMessage,
  fallback?: AlertFallback | null,
): Promise<'fallback-accepted' | 'undelivered'> {
  let running = fallbackInFlight.get(db);
  if (!running) {
    running = new Map();
    fallbackInFlight.set(db, running);
  }
  const existing = running.get(id);
  if (existing) return existing;
  const pending = (async () => {
    let alertStatus: 'fallback-accepted' | 'undelivered' = 'undelivered';
    try {
      const channel = fallback === undefined ? smtpAlertFallback() : fallback;
      if (channel !== null) {
        await channel.send(message, id);
        alertStatus = 'fallback-accepted';
      }
    } catch {
      process.stderr.write(`ALERT FALLBACK FAILED ${id}\n`);
    }
    db.update(pushDelivery).set({ alertStatus }).where(eq(pushDelivery.id, id)).run();
    if (alertStatus === 'undelivered') process.stderr.write(`ALERT UNDELIVERED ${id}\n`);
    return alertStatus;
  })();
  running.set(id, pending);
  try {
    return await pending;
  } finally {
    running.delete(id);
  }
}

export async function sweepPendingPushAlerts(
  db: Db,
  fallback?: AlertFallback | null,
  now = Date.now(),
): Promise<void> {
  const rows = db.select().from(pushDelivery).where(eq(pushDelivery.alertStatus, 'pending')).all();
  for (const row of rows) {
    const deadline = row.createdAt + 600_000;
    if (row.receivedAt !== null && row.receivedAt <= deadline) {
      db.update(pushDelivery)
        .set({ alertStatus: 'received' })
        .where(and(eq(pushDelivery.id, row.id), eq(pushDelivery.alertStatus, 'pending')))
        .run();
    } else if (deadline <= now) {
      await settleFallback(
        db,
        row.id,
        row.message ?? {
          title: 'Alert recovery',
          body: 'Pending alert recovered after restart',
          href: '/app',
          tag: row.id,
        },
        fallback,
      );
    }
  }
}

export async function sendMustReachAlert(
  db: Db,
  vapid: VapidKeys | null,
  userId: string,
  teamId: string,
  message: PushMessage,
  fallback?: AlertFallback | null,
  id = newRecordId(),
): Promise<{ push: PushOutcome; alertStatus: 'received' | 'fallback-accepted' | 'undelivered' }> {
  const deadline = Date.now() + 600_000;
  let push: PushOutcome;
  if (vapid === null) {
    db.insert(pushDelivery)
      .values({ id, userId, teamId, message, createdAt: nowMs(), alertStatus: 'pending' })
      .run();
    push = { status: 'failed', id };
  } else {
    push = await sendPushToUser(db, vapid, userId, teamId, message, { id, required: true });
  }
  db.update(pushDelivery).set({ pushStatus: push.status }).where(eq(pushDelivery.id, id)).run();
  if (push.status === 'delivered') {
    for (;;) {
      const row = db.select().from(pushDelivery).where(eq(pushDelivery.id, id)).get();
      if (row?.alertStatus === 'fallback-accepted' || row?.alertStatus === 'undelivered')
        return { push, alertStatus: row.alertStatus };
      if (row?.receivedAt !== null && row?.receivedAt !== undefined && row.receivedAt <= deadline) {
        db.update(pushDelivery)
          .set({ alertStatus: 'received' })
          .where(eq(pushDelivery.id, id))
          .run();
        return { push, alertStatus: 'received' };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, remaining)));
    }
  }
  return { push, alertStatus: await settleFallback(db, id, message, fallback) };
}
