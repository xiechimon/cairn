import type { MailAccountStatus, MailErrorCode } from '@cairn/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { mailAccount, mailEvent, mailRule } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  deliverMailEvent,
  type MailDeps,
  markMailAccount,
  rankMailEvent,
  transitionMailAccount,
} from './mail.js';
import {
  type MailboxMessage,
  MailAuthError,
  type MailboxSession,
  type OpenMailbox,
  openImapMailbox,
} from './mail-imap.js';
import { deleteSecret, openMailPassword, type SecretDeps } from './secrets.js';

const LIVE_STATUSES: readonly MailAccountStatus[] = ['connecting', 'watching', 'degraded'];
const EXCERPT_STORE_CHARS = 2000;
const NO_BODY = '(无正文)';

export interface MailConnectorLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface MailConnectorOptions {
  secrets: SecretDeps;
  mailDeps: MailDeps;
  openMailbox?: OpenMailbox;
  backoff?: { initialMs: number; maxMs: number };
  log?: MailConnectorLog;
}

export interface MailConnector {
  resume(): void;
  connect(accountId: string): void;
  disconnect(teamId: string, accountId: string): Promise<void>;
  shutdown(): Promise<void>;
}

interface Runner {
  abort: AbortController;
  session: MailboxSession | null;
  done: Promise<void>;
}

class Stopped extends Error {}

function errorCode(error: unknown): MailErrorCode {
  if (error instanceof MailAuthError) return 'auth-rejected';
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host-not-found';
  if (code === 'ECONNREFUSED') return 'connection-refused';
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  return 'connection-lost';
}

function clipText(text: string): string {
  return Array.from(text.replaceAll('\0', '').trim()).slice(0, EXCERPT_STORE_CHARS).join('');
}

export function createMailConnector(options: MailConnectorOptions): MailConnector {
  const { db } = options.secrets;
  const open = options.openMailbox ?? openImapMailbox;
  const backoff = options.backoff ?? { initialMs: 5_000, maxMs: 5 * 60_000 };
  const runners = new Map<string, Runner>();

  const account = (id: string) => db.select().from(mailAccount).where(eq(mailAccount.id, id)).get();

  const current = (id: string, generation: number) => {
    const row = account(id);
    if (row === undefined || row.generation !== generation || !LIVE_STATUSES.includes(row.status)) {
      throw new Stopped();
    }
    return row;
  };

  function deliver(eventId: string): void {
    try {
      rankMailEvent(db, eventId);
      deliverMailEvent(options.mailDeps, eventId);
    } catch (error) {
      options.log?.warn(
        { err: error instanceof Error ? error.name : 'error', eventId },
        'mail event could not be delivered',
      );
    }
  }

  function ingest(
    accountId: string,
    generation: number,
    uidValidity: string,
    mail: MailboxMessage,
  ) {
    return db.transaction(() => {
      const row = account(accountId);
      if (row === undefined || row.generation !== generation) return null;
      if (!LIVE_STATUSES.includes(row.status)) return null;
      const duplicate =
        mail.messageId !== null &&
        db
          .select({ id: mailEvent.id })
          .from(mailEvent)
          .where(and(eq(mailEvent.accountId, accountId), eq(mailEvent.messageId, mail.messageId)))
          .get() !== undefined;
      const id = newRecordId();
      const now = nowMs();
      const inserted = duplicate
        ? 0
        : db
            .insert(mailEvent)
            .values({
              id,
              accountId,
              externalId: `${uidValidity}:${mail.uid}`,
              status: 'received',
              generation,
              displayName: mail.fromName,
              fromAddress: mail.fromAddress,
              subject: mail.subject,
              excerpt: clipText(mail.text) || NO_BODY,
              messageId: mail.messageId,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .run().changes;
      db.update(mailAccount)
        .set({
          lastReconciledUid: Math.max(row.lastReconciledUid ?? 0, mail.uid),
          ...(inserted > 0 ? { lastMailAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(mailAccount.id, accountId))
        .run();
      return inserted > 0 ? id : null;
    });
  }

  function deliverPending(accountId: string, generation: number): void {
    const pending = db
      .select({ id: mailEvent.id })
      .from(mailEvent)
      .where(
        and(
          eq(mailEvent.accountId, accountId),
          eq(mailEvent.generation, generation),
          inArray(mailEvent.status, ['received', 'ranked']),
        ),
      )
      .all();
    for (const event of pending) deliver(event.id);
  }

  async function drain(accountId: string, generation: number, session: MailboxSession) {
    deliverPending(accountId, generation);
    for (;;) {
      const row = current(accountId, generation);
      const cursor = row.lastReconciledUid ?? 0;
      const batch = await session.fetchAfter(cursor);
      for (const mail of batch) {
        current(accountId, generation);
        const eventId = ingest(accountId, generation, session.uidValidity, mail);
        if (eventId !== null) deliver(eventId);
      }
      if (!batch.some((mail) => mail.uid > cursor)) return;
    }
  }

  function baseline(accountId: string, generation: number, session: MailboxSession): void {
    const row = current(accountId, generation);
    if (row.uidValidity === session.uidValidity && row.lastReconciledUid !== null) return;
    db.update(mailAccount)
      .set({
        uidValidity: session.uidValidity,
        lastReconciledUid: session.uidNext - 1,
        updatedAt: nowMs(),
      })
      .where(eq(mailAccount.id, accountId))
      .run();
  }

  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Stopped());
        },
        { once: true },
      );
    });
  }

  function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Stopped());
        return;
      }
      signal.addEventListener('abort', () => reject(new Stopped()), { once: true });
      promise.then(resolve, reject);
    });
  }

  async function run(accountId: string, generation: number, runner: Runner): Promise<void> {
    const { signal } = runner.abort;
    let delay = backoff.initialMs;
    while (!signal.aborted) {
      let session: MailboxSession | null = null;
      try {
        const row = current(accountId, generation);
        const password =
          row.secretId === null
            ? null
            : openMailPassword(options.secrets, row.teamId, row.secretId);
        if (password === null || row.address === null || row.imapHost === null) {
          markMailAccount(db, accountId, generation, 'revoked', 'auth-rejected');
          return;
        }
        const opening = open({
          host: row.imapHost,
          port: row.imapPort ?? 993,
          user: row.address,
          password,
        });
        try {
          session = await until(opening, signal);
        } catch (error) {
          opening.then((late) => late.close()).catch(() => {});
          throw error;
        }
        runner.session = session;
        baseline(accountId, generation, session);
        markMailAccount(db, accountId, generation, 'watching', null);
        delay = backoff.initialMs;
        for (;;) {
          await until(drain(accountId, generation, session), signal);
          await until(session.waitForChange(), signal);
        }
      } catch (error) {
        if (error instanceof Stopped || signal.aborted) return;
        if (error instanceof MailAuthError) {
          markMailAccount(db, accountId, generation, 'revoked', 'auth-rejected');
          return;
        }
        const code = errorCode(error);
        options.log?.warn({ accountId, code }, 'mailbox connection failed');
        markMailAccount(db, accountId, generation, 'degraded', code);
        try {
          await sleep(delay, signal);
        } catch {
          return;
        }
        delay = Math.min(delay * 2, backoff.maxMs);
      } finally {
        runner.session = null;
        await session?.close().catch(() => {});
      }
    }
  }

  function connect(accountId: string): void {
    if (runners.has(accountId)) return;
    const row = account(accountId);
    if (row === undefined || !LIVE_STATUSES.includes(row.status)) return;
    const runner: Runner = {
      abort: new AbortController(),
      session: null,
      done: Promise.resolve(),
    };
    runner.done = run(accountId, row.generation, runner).finally(() => {
      if (runners.get(accountId) === runner) runners.delete(accountId);
    });
    runners.set(accountId, runner);
  }

  async function stopRunner(accountId: string): Promise<void> {
    const runner = runners.get(accountId);
    if (runner === undefined) return;
    runner.abort.abort();
    await runner.session?.close().catch(() => {});
    await runner.done;
  }

  return {
    resume() {
      const rows = db
        .select({ id: mailAccount.id })
        .from(mailAccount)
        .where(
          and(
            inArray(mailAccount.status, [...LIVE_STATUSES]),
            isNotNull(mailAccount.secretId),
            eq(mailAccount.provider, 'imap'),
          ),
        )
        .all();
      for (const row of rows) connect(row.id);
    },
    connect,
    async disconnect(teamId, accountId) {
      const row = account(accountId);
      if (row === undefined || row.teamId !== teamId || row.status === 'disconnected') {
        throw notFound(`mail account ${accountId}`);
      }
      db.transaction(() => {
        transitionMailAccount(db, accountId, 'disconnected');
        db.update(mailAccount)
          .set({ secretId: null, lastError: null })
          .where(eq(mailAccount.id, accountId))
          .run();
        db.delete(mailRule).where(eq(mailRule.accountId, accountId)).run();
        if (row.secretId !== null) deleteSecret(options.secrets, teamId, row.secretId);
      });
      await stopRunner(accountId);
    },
    async shutdown() {
      await Promise.all([...runners.keys()].map(stopRunner));
    },
  };
}
