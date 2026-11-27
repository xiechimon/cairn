import type { AskUserQuestion } from '@cairn/shared';
import type { Db } from '../../db/client.js';
import type { CommitEffects } from '../../db/commit-effects.js';
import { databaseIdentity } from '../../db/identity.js';
import type { step } from '../../db/schema.js';

export type ImStepRow = typeof step.$inferSelect;

export interface ImAwayNoticeInput {
  teamId: string;
  entityId: string;
  title: string;
  body: string;
  href: string;
  deliveryId: string;
  effects?: CommitEffects;
}

export interface ImRuntimeHooks {
  assertQuestionFits(
    threadId: string,
    requestId: string,
    questions: readonly AskUserQuestion[],
  ): void;
  notice(threadId: string, text: string, card?: { requestId: string }): void;
  turnFinished(stepRow: ImStepRow): void;
  hasActiveOrigin?(threadId: string): boolean;
  sendAwayNotice?(input: ImAwayNoticeInput): { sent: boolean; connectionId?: string };
}

let current: ImRuntimeHooks | null = null;
const hooksByDb = new WeakMap<Db, ImRuntimeHooks>();

export function setImRuntime(hooks: ImRuntimeHooks | null, db?: Db): void {
  if (db !== undefined) {
    const root = databaseIdentity(db);
    if (hooks === null) hooksByDb.delete(root);
    else hooksByDb.set(root, hooks);
    return;
  }
  current = hooks;
}

function resolveHooks(db?: Db): ImRuntimeHooks | null {
  if (db !== undefined) {
    const found = hooksByDb.get(databaseIdentity(db));
    if (found !== undefined) return found;
  }
  return current;
}

export function assertImQuestionFits(
  threadId: string,
  requestId: string,
  questions: readonly AskUserQuestion[],
  db?: Db,
): void {
  resolveHooks(db)?.assertQuestionFits(threadId, requestId, questions);
}

export function imNotice(
  threadId: string,
  text: string,
  card?: { requestId: string },
  db?: Db,
): void {
  resolveHooks(db)?.notice(threadId, text, card);
}

export function imTurnFinished(stepRow: ImStepRow, db?: Db): void {
  resolveHooks(db)?.turnFinished(stepRow);
}

export function imHasActiveOrigin(threadId: string, db?: Db): boolean {
  return resolveHooks(db)?.hasActiveOrigin?.(threadId) ?? false;
}

export function imSendAwayNotice(
  input: ImAwayNoticeInput,
  db?: Db,
): { sent: boolean; connectionId?: string } {
  return resolveHooks(db)?.sendAwayNotice?.(input) ?? { sent: false };
}
