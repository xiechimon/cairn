import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import type { Db } from '../db/client.js';
import { pushDigestItem, pushSubscription } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
  webOrigin: string;
}

export interface PushMessage {
  title: string;
  body: string;
  href: string;
  tag: string;
}

const DEFAULT_VAPID_SUBJECT = 'mailto:push@cairn.dev';
const TTL = 60 * 60;
const GONE_STATUSES = new Set([404, 410]);

export function loadOrCreateVapidKeys(
  keysPath: string,
  subject = DEFAULT_VAPID_SUBJECT,
  webOrigin = 'https://cairn.local',
): VapidKeys {
  const directory = dirname(resolve(keysPath));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory()) throw new Error('vapid keys parent is not a directory');
  const directoryDescriptor = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedDirectoryStat = fstatSync(directoryDescriptor);
    if (!openedDirectoryStat.isDirectory()) throw new Error('vapid keys parent is not a directory');
    fchmodSync(directoryDescriptor, 0o700);
    let fileDescriptor: number;
    try {
      fileDescriptor = openSync(
        keysPath,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      const keys = webpush.generateVAPIDKeys();
      const contents = Buffer.from(`${JSON.stringify(keys)}\n`);
      writeSync(fileDescriptor, contents, 0, contents.length, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      fileDescriptor = openSync(keysPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    try {
      const fileStat = fstatSync(fileDescriptor);
      if (!fileStat.isFile() || fileStat.nlink !== 1) {
        throw new Error('vapid keys file is not a safe regular file');
      }
      fchmodSync(fileDescriptor, 0o600);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(fileDescriptor, 'utf8'));
      } catch {
        throw new Error('vapid keys file malformed');
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { publicKey?: unknown }).publicKey !== 'string' ||
        typeof (parsed as { privateKey?: unknown }).privateKey !== 'string'
      ) {
        throw new Error('vapid keys file malformed');
      }
      const keys = parsed as { publicKey: string; privateKey: string };
      return { ...keys, subject, webOrigin };
    } finally {
      closeSync(fileDescriptor);
    }
  } finally {
    closeSync(directoryDescriptor);
  }
}

export function buildPushPayload(origin: string, msg: PushMessage): string {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: msg.title.slice(0, 200),
      body: msg.body,
      navigate: `${origin}${msg.href}`,
      tag: msg.tag,
    },
  });
}

export async function sendPushToUser(
  db: Db,
  vapid: VapidKeys,
  userId: string,
  teamId: string,
  msg: PushMessage,
): Promise<boolean> {
  const rows = db
    .select()
    .from(pushSubscription)
    .where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.teamId, teamId)))
    .all();
  const results = await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
            expirationTime: null,
          },
          buildPushPayload(vapid.webOrigin, msg),
          { timeout: 10_000, TTL, vapidDetails: vapid },
        );
        return true;
      } catch (err) {
        if (err instanceof webpush.WebPushError && GONE_STATUSES.has(err.statusCode)) {
          db.delete(pushSubscription)
            .where(
              and(
                eq(pushSubscription.endpoint, row.endpoint),
                eq(pushSubscription.userId, userId),
                eq(pushSubscription.teamId, teamId),
              ),
            )
            .run();
          return true;
        }
        process.stderr.write('web push delivery failed\n');
        return false;
      }
    }),
  );
  return results.every((result) => result.status === 'fulfilled' && result.value);
}

export function pushToUserSafely(
  db: Db,
  vapid: VapidKeys | null,
  userId: string,
  teamId: string,
  msg: PushMessage,
): void {
  if (vapid === null) return;
  void sendPushToUser(db, vapid, userId, teamId, msg).catch(() => {
    process.stderr.write('web push delivery failed\n');
  });
}

export function queuePushDigest(db: Db, userId: string, teamId: string, msg: PushMessage): void {
  db.insert(pushDigestItem)
    .values({
      id: newRecordId(),
      userId,
      teamId,
      title: msg.title,
      body: msg.body,
      href: msg.href,
      createdAt: nowMs(),
    })
    .run();
}

export function buildDigestBody(items: readonly { title: string; body: string }[]): string {
  return items.map((item) => `${item.title}: ${item.body}`).join('\n');
}

export function digestSlotDueAt(now: number, hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (match === null) return null;
  const local = new Date(now);
  local.setHours(Number(match[1]), Number(match[2]), 0, 0);
  const at = local.getTime();
  return at <= now ? at : null;
}

export function digestSlotsDue(
  now: number,
  times: readonly string[],
  lastRunAt: ReadonlyMap<string, number>,
): string[] {
  return times.filter((slot) => {
    const at = digestSlotDueAt(now, slot);
    return at !== null && (lastRunAt.get(slot) ?? 0) < at;
  });
}

export async function sweepPushDigest(db: Db, vapid: VapidKeys | null): Promise<void> {
  if (vapid === null) return;
  const groups = db
    .select({ userId: pushDigestItem.userId, teamId: pushDigestItem.teamId })
    .from(pushDigestItem)
    .groupBy(pushDigestItem.userId, pushDigestItem.teamId)
    .all();
  for (const group of groups) {
    const items = db
      .select()
      .from(pushDigestItem)
      .where(and(eq(pushDigestItem.userId, group.userId), eq(pushDigestItem.teamId, group.teamId)))
      .all();
    if (items.length === 0) continue;
    const delivered = await sendPushToUser(db, vapid, group.userId, group.teamId, {
      title: '每日简报',
      body: buildDigestBody(items).slice(0, 800),
      href: '/app',
      tag: `${group.userId}:digest`,
    });
    if (delivered) {
      for (const item of items) {
        db.delete(pushDigestItem).where(eq(pushDigestItem.id, item.id)).run();
      }
    }
  }
}
