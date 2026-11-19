import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface MailboxConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface MailboxMessage {
  uid: number;
  messageId: string | null;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  text: string;
}

export interface MailboxSession {
  uidValidity: string;
  uidNext: number;
  supportsIdle: boolean;
  fetchAfter(uid: number): Promise<MailboxMessage[]>;
  waitForChange(): Promise<void>;
  close(): Promise<void>;
}

export type OpenMailbox = (config: MailboxConfig) => Promise<MailboxSession>;

export class MailAuthError extends Error {}

export const MAIL_SOURCE_MAX_BYTES = 256 * 1024;
const IDLE_RESTART_MS = 5 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 30 * 1000;
const FETCH_BATCH = 100;

function clean(value: string | undefined): string | null {
  const text = value?.replaceAll('\0', '').trim();
  return text === undefined || text === '' ? null : text;
}

export const openImapMailbox: OpenMailbox = async (config) => {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port !== 143,
    doSTARTTLS: config.port === 143,
    auth: { user: config.user, pass: config.password },
    logger: false,
    maxIdleTime: IDLE_RESTART_MS,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    clientInfo: { name: 'cairn' },
  });
  let closed: Error | null = null;
  const waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  let pendingChange = false;
  client.on('error', (error: Error) => {
    closed = error;
    for (const waiter of waiters) waiter.reject(error);
    waiters.clear();
  });
  client.on('close', () => {
    closed ??= new Error('connection closed');
    for (const waiter of waiters) waiter.reject(closed);
    waiters.clear();
  });
  client.on('exists', (event: { count: number; prevCount: number }) => {
    if (event.count <= event.prevCount) return;
    pendingChange = true;
    for (const waiter of waiters) waiter.resolve();
    waiters.clear();
  });
  try {
    await client.connect();
  } catch (error) {
    if ((error as { authenticationFailed?: boolean }).authenticationFailed === true) {
      throw new MailAuthError('login rejected');
    }
    throw error;
  }
  const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
  return {
    uidValidity: String(mailbox.uidValidity),
    uidNext: mailbox.uidNext,
    supportsIdle: client.capabilities.has('IDLE'),
    async fetchAfter(uid) {
      const found = await client.search({ uid: `${uid + 1}:*` }, { uid: true });
      const uids = (found || []).filter((value) => value > uid).slice(0, FETCH_BATCH);
      if (uids.length === 0) return [];
      const messages: MailboxMessage[] = [];
      const rows = await client.fetchAll(
        uids.join(','),
        { uid: true, envelope: true, source: { maxLength: MAIL_SOURCE_MAX_BYTES } },
        { uid: true },
      );
      for (const row of rows.sort((a, b) => a.uid - b.uid)) {
        const parsed = row.source === undefined ? null : await simpleParser(row.source);
        const from = row.envelope?.from?.[0];
        messages.push({
          uid: row.uid,
          messageId: clean(row.envelope?.messageId),
          fromName: clean(from?.name),
          fromAddress: clean(from?.address)?.toLowerCase() ?? null,
          subject: clean(row.envelope?.subject),
          text: parsed?.text ?? '',
        });
      }
      return messages;
    },
    waitForChange() {
      if (pendingChange) {
        pendingChange = false;
        return Promise.resolve();
      }
      if (closed !== null) return Promise.reject(closed);
      return new Promise<void>((resolve, reject) => {
        waiters.add({ resolve, reject });
      });
    },
    async close() {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    },
  };
};
