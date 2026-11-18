import type {
  MailAccountCreateBody,
  MailAccountRecord,
  MailErrorCode,
  MailRuleCreateBody,
  MailWakeMode,
} from '@cairn/shared';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { mailAccount, mailRule } from '../db/schema.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { createSecret, type SecretDeps } from './secrets.js';

type AccountRow = typeof mailAccount.$inferSelect;

const WAKE_RANK = { all: 'needs_you', rules: 'can_wait' } as const;

function toRecord(db: Db, row: AccountRow): MailAccountRecord {
  const rules = db
    .select()
    .from(mailRule)
    .where(eq(mailRule.accountId, row.id))
    .orderBy(asc(mailRule.createdAt), asc(mailRule.id))
    .all();
  return {
    id: row.id,
    address: row.address ?? '',
    imapHost: row.imapHost ?? '',
    imapPort: row.imapPort ?? 993,
    smtpHost: row.smtpHost ?? '',
    smtpPort: row.smtpPort ?? 465,
    status: row.status,
    lastError: row.lastError as MailErrorCode | null,
    lastMailAt: row.lastMailAt,
    wakeMode: row.defaultRank === 'needs_you' ? 'all' : 'rules',
    rules: rules.map((rule) => ({
      id: rule.id,
      matchKind: rule.matchKind,
      pattern: rule.pattern,
    })),
  };
}

export function listMailAccounts(db: Db, teamId: string): MailAccountRecord[] {
  return db
    .select()
    .from(mailAccount)
    .where(and(eq(mailAccount.teamId, teamId), ne(mailAccount.status, 'disconnected')))
    .orderBy(asc(mailAccount.createdAt), asc(mailAccount.id))
    .all()
    .filter((row) => row.provider === 'imap')
    .map((row) => toRecord(db, row));
}

export function requireMailAccount(db: Db, teamId: string, id: string): AccountRow {
  const row = db
    .select()
    .from(mailAccount)
    .where(and(eq(mailAccount.id, id), eq(mailAccount.teamId, teamId)))
    .get();
  if (row === undefined || row.status === 'disconnected') throw notFound(`mail account ${id}`);
  return row;
}

export function createMailAccount(
  deps: SecretDeps,
  input: { teamId: string; userId: string; body: MailAccountCreateBody },
): MailAccountRecord {
  const address = input.body.address.toLowerCase();
  const existing = deps.db
    .select({ id: mailAccount.id })
    .from(mailAccount)
    .where(
      and(
        eq(mailAccount.teamId, input.teamId),
        eq(mailAccount.address, address),
        ne(mailAccount.status, 'disconnected'),
      ),
    )
    .get();
  if (existing !== undefined) throw conflict(`mailbox ${address} is already connected`);
  const id = newRecordId();
  const row = deps.db.transaction(() => {
    const secret = createSecret(deps, {
      teamId: input.teamId,
      name: `mail.imap.${id}`,
      value: input.body.password,
    });
    const now = nowMs();
    deps.db
      .insert(mailAccount)
      .values({
        id,
        teamId: input.teamId,
        userId: input.userId,
        provider: 'imap',
        mailbox: 'INBOX',
        status: 'connecting',
        generation: 1,
        secretId: secret.id,
        address,
        imapHost: input.body.imapHost.toLowerCase(),
        imapPort: input.body.imapPort,
        smtpHost: input.body.smtpHost.toLowerCase(),
        smtpPort: input.body.smtpPort,
        defaultRank: WAKE_RANK[input.body.wakeMode],
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return deps.db.select().from(mailAccount).where(eq(mailAccount.id, id)).get();
  });
  if (row === undefined) throw new Error('mail account missing after insert');
  return toRecord(deps.db, row);
}

export function setMailWakeMode(
  db: Db,
  teamId: string,
  id: string,
  mode: MailWakeMode,
): MailAccountRecord {
  requireMailAccount(db, teamId, id);
  db.update(mailAccount)
    .set({ defaultRank: WAKE_RANK[mode], updatedAt: nowMs() })
    .where(eq(mailAccount.id, id))
    .run();
  return toRecord(db, requireMailAccount(db, teamId, id));
}

export function addMailRule(
  db: Db,
  teamId: string,
  id: string,
  body: MailRuleCreateBody,
): MailAccountRecord {
  requireMailAccount(db, teamId, id);
  const pattern = body.pattern.trim();
  const duplicate = db
    .select()
    .from(mailRule)
    .where(eq(mailRule.accountId, id))
    .all()
    .some(
      (rule) =>
        rule.matchKind === body.matchKind && rule.pattern.toLowerCase() === pattern.toLowerCase(),
    );
  if (duplicate) throw new HttpError(409, 'this rule already exists');
  db.insert(mailRule)
    .values({
      id: newRecordId(),
      accountId: id,
      name: body.matchKind === 'sender_allow' ? `发件人 ${pattern}` : `主题含 ${pattern}`,
      matchKind: body.matchKind,
      pattern,
      rank: 'needs_you',
      createdAt: nowMs(),
    })
    .run();
  return toRecord(db, requireMailAccount(db, teamId, id));
}

export function removeMailRule(
  db: Db,
  teamId: string,
  id: string,
  ruleId: string,
): MailAccountRecord {
  requireMailAccount(db, teamId, id);
  db.delete(mailRule)
    .where(and(eq(mailRule.id, ruleId), eq(mailRule.accountId, id)))
    .run();
  return toRecord(db, requireMailAccount(db, teamId, id));
}
