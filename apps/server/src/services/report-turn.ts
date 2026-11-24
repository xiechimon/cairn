import { createHash } from 'node:crypto';
import {
  CHIEF_TOOL_CATEGORIES,
  COMPUTER_DIRECT_TOOLS,
  COMPUTER_OBSERVE_TOOLS,
  CONNECTOR_TOOL_PREFIX,
  deliverablesMessageSchema,
  INSTALL_PACKAGES_TOOL,
  MEMORY_TOOLS,
  REPORT_ACK_KIND,
  type ReportAckContent,
} from '@cairn/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { actionProposal, build, chiefMessage, chiefThread, message, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { resolveToolAttachmentId } from './attachments.js';
import { insertChiefMessageOnce } from './chief.js';
import { DELIVERABLES_MESSAGE_PREFIX } from './machine-deliverables.js';
import { memoryEditIdOfPrompt } from './memory-edit-turns.js';
import { REPORT_PROVENANCE_PREFIX, reportProvenance, turnProvenance } from './turn-provenance.js';

export interface ReportRef {
  todoId: string;
  buildId: string;
  attachmentId: string;
  threadId: string;
  originThreadId: string | null;
}

const REPORT_LINE_RE =
  /\nReport todo=(\S+) build=(\S+) attachment=(\S+) thread=(\S+) origin=(none|thread:\S+)\nGate todo=\S+ build=\S* phase=\w+ attempt=[01]$/;
const REPORT_OPEN_TOOLS = new Set([
  'todos',
  'conversation',
  'read_history',
  'search_history',
  'projects',
  'docs',
  'notify_user',
]);
const REPORT_REF_TOOLS = new Set([
  'attachment',
  'notify_user',
  'complete_todos',
  'archive_todos',
  'message_thread',
]);

const MAIL_TURN_OPEN_TOOLS: ReadonlySet<string> = new Set([
  ...CHIEF_TOOL_CATEGORIES.read.filter((name) => name !== 'secrets'),
  'create_todo',
  ...COMPUTER_OBSERVE_TOOLS,
  ...COMPUTER_DIRECT_TOOLS,
  INSTALL_PACKAGES_TOOL,
]);
const ACTION_WAKE_PROVENANCE_PREFIX = 'action-proposal:';

function mailTurnAllows(name: string): boolean {
  return MAIL_TURN_OPEN_TOOLS.has(name) || name.startsWith(CONNECTOR_TOOL_PREFIX);
}

function proposalFromUntrustedTurn(db: Db, proposalId: string): boolean {
  const row = db
    .select({ inputJson: actionProposal.inputJson })
    .from(actionProposal)
    .where(eq(actionProposal.id, proposalId))
    .get();
  if (row === undefined) return false;
  return (JSON.parse(row.inputJson) as { untrustedTurn?: unknown }).untrustedTurn === true;
}

export function turnForcesOutboundApproval(db: Db, prompt: string | null): boolean {
  const provenance = turnProvenance(prompt);
  if (provenance === null) return false;
  if (provenance.startsWith('mail:')) return true;
  return (
    provenance.startsWith(ACTION_WAKE_PROVENANCE_PREFIX) &&
    proposalFromUntrustedTurn(db, provenance.slice(ACTION_WAKE_PROVENANCE_PREFIX.length))
  );
}

export function reportLine(ref: ReportRef): string {
  const origin =
    ref.originThreadId === null ? 'none' : `thread:${encodeURIComponent(ref.originThreadId)}`;
  return `Report todo=${encodeURIComponent(ref.todoId)} build=${encodeURIComponent(ref.buildId)} attachment=${encodeURIComponent(ref.attachmentId)} thread=${encodeURIComponent(ref.threadId)} origin=${origin}`;
}

function isReportTurn(prompt: string | null): boolean {
  return turnProvenance(prompt)?.startsWith(REPORT_PROVENANCE_PREFIX) === true;
}

export function reportRefOfPrompt(prompt: string | null): ReportRef | null {
  if (!isReportTurn(prompt)) return null;
  const match = REPORT_LINE_RE.exec(prompt ?? '');
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) return null;
  const ref = {
    todoId: decodeURIComponent(match[1]),
    buildId: decodeURIComponent(match[2]),
    attachmentId: decodeURIComponent(match[3]),
    threadId: decodeURIComponent(match[4]),
    originThreadId:
      match[5] === 'none' ? null : decodeURIComponent(match[5].slice('thread:'.length)),
  };
  return turnProvenance(prompt) === reportProvenance(ref.todoId) ? ref : null;
}

function deliverableAttachmentIds(db: Db, buildId: string): Set<string> {
  const msg = db
    .select({ content: message.content })
    .from(message)
    .where(eq(message.id, `${DELIVERABLES_MESSAGE_PREFIX}${buildId}`))
    .get();
  if (msg === undefined) return new Set();
  try {
    const raw = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
    const parsed = deliverablesMessageSchema.safeParse(raw);
    return parsed.success ? new Set(parsed.data.items.map((i) => i.attachmentId)) : new Set();
  } catch {
    return new Set();
  }
}

function reportTurnAllows(
  db: Db,
  ref: ReportRef,
  name: string,
  params: Record<string, unknown>,
): boolean {
  if (REPORT_OPEN_TOOLS.has(name)) return true;
  if (name === 'attachment') {
    if (params.attachmentId === ref.attachmentId) return true;
    const rawId = typeof params.attachmentId === 'string' ? params.attachmentId : null;
    if (rawId === null) return false;
    const teamId = db
      .select({ teamId: todo.teamId })
      .from(todo)
      .where(eq(todo.id, ref.todoId))
      .get()?.teamId;
    if (teamId === undefined) return false;
    try {
      const resolved = resolveToolAttachmentId(db, teamId, rawId);
      return (
        resolved === ref.attachmentId || deliverableAttachmentIds(db, ref.buildId).has(resolved)
      );
    } catch {
      return deliverableAttachmentIds(db, ref.buildId).has(rawId);
    }
  }
  if (name === 'message_thread') return params.todoId === ref.todoId;
  if (name === 'complete_todos' || name === 'archive_todos') {
    const ids = params.todoIds;
    return Array.isArray(ids) && ids.length === 1 && ids[0] === ref.todoId;
  }
  return false;
}

export function reportRefOfCall(
  db: Db,
  prompt: string | null,
  ownerMessageIds: readonly string[],
  name: string,
  params: Record<string, unknown>,
): ReportRef | null {
  const ref = reportRefOfPrompt(prompt);
  if (ref === null) return null;
  return ownerMessageIds.length === 0 || reportTurnAllows(db, ref, name, params) ? ref : null;
}

export function refuseRestrictedTurnTool(
  db: Db,
  prompt: string | null,
  name: string,
  params: Record<string, unknown> = {},
  ownerMessageIds: readonly string[] = [],
): void {
  if (turnForcesOutboundApproval(db, prompt)) {
    if (mailTurnAllows(name)) return;
    throw new HttpError(403, `mail turn cannot call ${name}`);
  }
  if (memoryEditIdOfPrompt(prompt) !== null) {
    if ((MEMORY_TOOLS as readonly string[]).includes(name)) return;
    throw new HttpError(403, `memory-edit turn cannot call ${name}`);
  }
  if (!isReportTurn(prompt) || ownerMessageIds.length > 0) return;
  const ref = reportRefOfPrompt(prompt);
  if (ref !== null && reportTurnAllows(db, ref, name, params)) return;
  throw new HttpError(403, `report turn cannot call ${name}`);
}

export function reportRefCurrent(db: Db, ref: ReportRef): boolean {
  const row = db.select().from(todo).where(eq(todo.id, ref.todoId)).get();
  const thread = db
    .select({ teamId: chiefThread.teamId })
    .from(chiefThread)
    .where(eq(chiefThread.id, ref.threadId))
    .get();
  if (
    row === undefined ||
    thread === undefined ||
    row.teamId !== thread.teamId ||
    row.latestBuildId !== ref.buildId ||
    row.phase !== 'review'
  )
    return false;
  const stored = db
    .select({ attachmentId: build.reportAttachmentId })
    .from(build)
    .where(eq(build.id, ref.buildId))
    .get();
  return stored?.attachmentId === ref.attachmentId;
}

function reportOriginGone(db: Db, ref: ReportRef): boolean {
  if (ref.originThreadId === null) return false;
  const origin = db
    .select({ archivedAt: chiefThread.archivedAt })
    .from(chiefThread)
    .where(eq(chiefThread.id, ref.originThreadId))
    .get();
  return origin === undefined || origin.archivedAt !== null;
}

export function requireCurrentReportTurn(
  db: Db,
  prompt: string | null,
  ownerMessageIds: readonly string[],
  name: string,
  params: Record<string, unknown>,
): void {
  if (!REPORT_REF_TOOLS.has(name)) return;
  const ref = reportRefOfCall(db, prompt, ownerMessageIds, name, params);
  if (ref === null) return;
  if (!reportRefCurrent(db, ref)) {
    throw new HttpError(
      409,
      'report-stale: this report is no longer the task’s current delivery, so skip it and say nothing about it. Only the report is skipped: if the owner wrote in this turn, still do what they asked.',
    );
  }
  if ((name === 'notify_user' || name === 'message_thread') && reportOriginGone(db, ref)) {
    throw new HttpError(
      409,
      'report-origin-gone: the conversation that asked for this report is archived or deleted; accept it with complete_todos {silent: true} or archive it with archive_todos',
    );
  }
}

type ReportKey = Pick<ReportRef, 'todoId' | 'buildId' | 'attachmentId'>;

function reportHash(threadId: string, ref: ReportKey): string {
  return createHash('sha256')
    .update(`${threadId}\0${ref.todoId}\0${ref.buildId}\0${ref.attachmentId}`)
    .digest('hex')
    .slice(0, 24);
}

export function reportNoticeId(threadId: string, ref: ReportKey): string {
  return `report-notice-${reportHash(threadId, ref)}`;
}

function reportAckId(threadId: string, ref: ReportKey): string {
  return `report-silent-${reportHash(threadId, ref)}`;
}

export function reportAcknowledged(db: Db, threadId: string, ref: ReportRef): boolean {
  return (
    db
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(eq(chiefMessage.id, reportAckId(threadId, ref)))
      .get() !== undefined
  );
}

export function reportAnsweredIn(
  db: Db,
  threadId: string,
  record: { id: string; latestBuildId: string | null },
): boolean {
  if (record.latestBuildId === null) return false;
  const attachmentId = db
    .select({ id: build.reportAttachmentId })
    .from(build)
    .where(eq(build.id, record.latestBuildId))
    .get()?.id;
  if (!attachmentId) return false;
  const ref = { todoId: record.id, buildId: record.latestBuildId, attachmentId };
  return (
    db
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(inArray(chiefMessage.id, [reportNoticeId(threadId, ref), reportAckId(threadId, ref)]))
      .get() !== undefined
  );
}

export function acceptReport<T>(
  db: Db,
  threadId: string,
  ref: ReportRef,
  silent: boolean,
  complete: () => T,
): { result: T; ack: ReturnType<typeof insertChiefMessageOnce> } {
  return db.transaction(() => {
    let ack: ReturnType<typeof insertChiefMessageOnce> = null;
    if (silent) {
      if (ref.originThreadId !== null && !reportOriginGone(db, ref)) {
        throw new HttpError(
          409,
          'report-notice-required: the conversation that asked for this report is waiting; tell it the result with notify_user before complete_todos',
        );
      }
      ack = insertChiefMessageOnce(db, {
        id: reportAckId(threadId, ref),
        threadId,
        role: 'system' as const,
        content: JSON.stringify({
          kind: REPORT_ACK_KIND,
          mode: 'silent',
          todoId: ref.todoId,
          buildId: ref.buildId,
        } satisfies ReportAckContent),
        createdAt: nowMs(),
      });
    } else if (
      db
        .select({ id: chiefMessage.id })
        .from(chiefMessage)
        .where(eq(chiefMessage.id, reportNoticeId(threadId, ref)))
        .get() === undefined
    ) {
      throw new HttpError(
        409,
        'report-notice-required: send the conclusion with notify_user first, or pass silent: true when the report has nothing new and nobody is waiting for it',
      );
    }
    return { result: complete(), ack };
  });
}
