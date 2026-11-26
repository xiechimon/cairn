import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  anchorFitsKind,
  artifactKindOf,
  type ChiefSendMessageBody,
  DESIGN_LIMITS,
  type DesignCommentCreate,
  type DesignCommentPatch,
  type DesignCommentRecord,
  type DesignCommentRetarget,
  formatAttachmentToken,
  renderArtifactCommentSummary,
  renderDesignCommentBlock,
} from '@cairn/shared';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, clientMessage, designComment, designVersion, todo } from '../db/schema.js';
import { HttpError, taskArchived } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { TEAM_ATTACHMENTS_QUOTA_BYTES, teamAttachmentBytes } from './attachment-gc.js';
import { writeAttachmentFile } from './attachments.js';
import { sendChiefMessageFromComposer } from './chief.js';
import { messageThreadAsUser } from './thread-message.js';

type CommentRow = typeof designComment.$inferSelect;
type SendDeps = Parameters<typeof sendChiefMessageFromComposer>[0] &
  Parameters<typeof messageThreadAsUser>[0];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function requireWritableTodo(db: Db, teamId: string, todoId: string): typeof todo.$inferSelect {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  if (row.archivedAt !== null) throw taskArchived();
  return row;
}

function commentRecord(
  row: CommentRow,
  versionSeq: number,
  handledSeq: number | null,
): DesignCommentRecord {
  return {
    id: row.id,
    todoId: row.todoId,
    fileName: row.fileName,
    versionId: row.versionId,
    versionSeq,
    pin: row.pin,
    elementId: row.elementId,
    selector: row.selector,
    label: row.label,
    text: row.text,
    htmlHint: row.htmlHint,
    position: row.position,
    viewport: row.viewport,
    style: row.style ?? null,
    note: row.note,
    markAttachmentId: row.markAttachmentId,
    status: row.status,
    messageId: row.messageId,
    anchor: row.anchor ?? null,
    sentAt: row.sentAt ?? null,
    handledSeq,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function handledSeqOf(db: Db, row: CommentRow): number | null {
  if (row.sentAt === null || row.status !== 'sent') return null;
  return (
    db
      .select({ seq: designVersion.seq })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.todoId, row.todoId),
          eq(designVersion.fileName, row.fileName),
          gte(designVersion.createdAt, row.sentAt),
        ),
      )
      .orderBy(designVersion.seq)
      .get()?.seq ?? null
  );
}

function versionSeqs(db: Db, versionIds: string[]): Map<string, number> {
  if (versionIds.length === 0) return new Map();
  return new Map(
    db
      .select({ id: designVersion.id, seq: designVersion.seq })
      .from(designVersion)
      .where(inArray(designVersion.id, versionIds))
      .all()
      .map((v) => [v.id, v.seq]),
  );
}

function recordsOf(db: Db, rows: CommentRow[]): DesignCommentRecord[] {
  const seqs = versionSeqs(db, [...new Set(rows.map((r) => r.versionId))]);
  return rows.map((r) => commentRecord(r, seqs.get(r.versionId) ?? 1, handledSeqOf(db, r)));
}

export function listDesignComments(
  db: Db,
  teamId: string,
  todoId: string,
  fileName: string,
): DesignCommentRecord[] {
  return recordsOf(
    db,
    db
      .select()
      .from(designComment)
      .where(
        and(
          eq(designComment.teamId, teamId),
          eq(designComment.todoId, todoId),
          eq(designComment.fileName, fileName),
        ),
      )
      .orderBy(designComment.pin)
      .all(),
  );
}

export function saveDesignMark(
  deps: { db: Db; attachmentsDir: string },
  input: { teamId: string; todoId: string; userId: string; pngBase64: string },
): { attachmentId: string } {
  requireWritableTodo(deps.db, input.teamId, input.todoId);
  const bytes = Buffer.from(input.pngBase64, 'base64');
  if (bytes.length === 0 || bytes.length > DESIGN_LIMITS.markBytes) {
    throw new HttpError(400, 'mark image must be a PNG up to 5 MiB');
  }
  if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new HttpError(400, 'mark image must be a PNG up to 5 MiB');
  }
  if (teamAttachmentBytes(deps.db, input.teamId) + bytes.length > TEAM_ATTACHMENTS_QUOTA_BYTES) {
    throw new HttpError(413, 'attachment quota exceeded');
  }
  const id = newRecordId();
  const storageKey = `${input.teamId}/${id}.png`;
  writeAttachmentFile(deps.attachmentsDir, storageKey, bytes);
  try {
    deps.db
      .insert(attachment)
      .values({
        id,
        teamId: input.teamId,
        todoId: input.todoId,
        createdBy: input.userId,
        fileName: 'mark.png',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        storageKey,
        grantId: newRecordId(),
        scope: 'design',
        status: 'ready',
        createdAt: nowMs(),
      })
      .run();
    return { attachmentId: id };
  } catch (error) {
    rmSync(join(deps.attachmentsDir, storageKey), { force: true });
    throw error;
  }
}

export function createDesignComment(
  db: Db,
  input: { teamId: string; todoId: string; userId: string; body: DesignCommentCreate },
): DesignCommentRecord {
  requireWritableTodo(db, input.teamId, input.todoId);
  const version = db
    .select()
    .from(designVersion)
    .where(
      and(
        eq(designVersion.id, input.body.versionId),
        eq(designVersion.todoId, input.todoId),
        eq(designVersion.teamId, input.teamId),
      ),
    )
    .get();
  if (!version) throw new HttpError(404, `design version ${input.body.versionId}`);
  const anchor = input.body.anchor ?? null;
  if (!anchorFitsKind(artifactKindOf(version.fileName), anchor)) {
    throw new HttpError(400, 'this kind of file cannot take that comment target');
  }
  const markId = input.body.markAttachmentId ?? null;
  if (markId !== null) {
    const mark = db
      .select({ id: attachment.id })
      .from(attachment)
      .where(
        and(
          eq(attachment.id, markId),
          eq(attachment.teamId, input.teamId),
          eq(attachment.todoId, input.todoId),
          eq(attachment.scope, 'design'),
          eq(attachment.createdBy, input.userId),
        ),
      )
      .get();
    if (!mark) throw new HttpError(404, `mark ${markId}`);
  }
  const row = db.transaction(() => {
    const last = db
      .select({ pin: designComment.pin })
      .from(designComment)
      .where(
        and(eq(designComment.todoId, input.todoId), eq(designComment.fileName, version.fileName)),
      )
      .orderBy(desc(designComment.pin))
      .get();
    const now = nowMs();
    const next: CommentRow = {
      id: newRecordId(),
      teamId: input.teamId,
      todoId: input.todoId,
      fileName: version.fileName,
      versionId: version.id,
      pin: (last?.pin ?? 0) + 1,
      elementId: input.body.elementId,
      selector: input.body.selector,
      label: input.body.label,
      text: input.body.text,
      htmlHint: input.body.htmlHint,
      position: input.body.position,
      viewport: input.body.viewport,
      style: input.body.style,
      note: input.body.note,
      markAttachmentId: markId,
      status: 'open',
      messageId: null,
      anchor,
      sentAt: null,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(designComment).values(next).run();
    return next;
  });
  return commentRecord(row, version.seq, null);
}

function requireComment(db: Db, teamId: string, todoId: string, commentId: string): CommentRow {
  const row = db
    .select()
    .from(designComment)
    .where(
      and(
        eq(designComment.id, commentId),
        eq(designComment.todoId, todoId),
        eq(designComment.teamId, teamId),
      ),
    )
    .get();
  if (!row) throw new HttpError(404, `design comment ${commentId}`);
  return row;
}

function retargetFields(db: Db, row: CommentRow, body: DesignCommentRetarget) {
  if (row.status === 'open') throw new HttpError(409, 'an open comment is moved by editing it');
  const version = db
    .select()
    .from(designVersion)
    .where(
      and(
        eq(designVersion.id, body.versionId),
        eq(designVersion.todoId, row.todoId),
        eq(designVersion.fileName, row.fileName),
      ),
    )
    .get();
  if (!version) throw new HttpError(404, `design version ${body.versionId}`);
  const anchor = body.anchor ?? null;
  if (!anchorFitsKind(artifactKindOf(row.fileName), anchor)) {
    throw new HttpError(400, 'this kind of file cannot take that comment target');
  }
  return {
    versionId: version.id,
    elementId: body.elementId,
    selector: body.selector,
    label: body.label,
    text: body.text,
    htmlHint: body.htmlHint,
    position: body.position,
    viewport: body.viewport,
    style: body.style,
    anchor,
    status: 'open' as const,
    messageId: null,
    sentAt: null,
  };
}

export function patchDesignComment(
  db: Db,
  input: { teamId: string; todoId: string; commentId: string; body: DesignCommentPatch },
): DesignCommentRecord {
  requireWritableTodo(db, input.teamId, input.todoId);
  const row = requireComment(db, input.teamId, input.todoId, input.commentId);
  if (input.body.note !== undefined && row.status !== 'open') {
    throw new HttpError(409, 'only an open comment can be edited');
  }
  const status = input.body.status;
  if (status === 'resolved' && row.status === 'resolved')
    throw new HttpError(409, 'already resolved');
  if (status === 'open' && row.status !== 'resolved') {
    throw new HttpError(409, 'only a resolved comment can be reopened');
  }
  const next = {
    ...(input.body.note !== undefined ? { note: input.body.note } : {}),
    ...(status !== undefined
      ? { status, ...(status === 'open' ? { messageId: null, sentAt: null } : {}) }
      : {}),
    ...(input.body.retarget !== undefined ? retargetFields(db, row, input.body.retarget) : {}),
    updatedAt: nowMs(),
  };
  db.update(designComment).set(next).where(eq(designComment.id, row.id)).run();
  return recordsOf(db, [{ ...row, ...next }])[0] as DesignCommentRecord;
}

export function deleteDesignComment(
  db: Db,
  input: { teamId: string; todoId: string; commentId: string },
): void {
  requireWritableTodo(db, input.teamId, input.todoId);
  const row = requireComment(db, input.teamId, input.todoId, input.commentId);
  if (row.status !== 'open') throw new HttpError(409, 'a sent comment stays in the transcript');
  db.delete(designComment).where(eq(designComment.id, row.id)).run();
}

const RELAY_NOTICE = '（Cairn 已把这些批注转给任务「';

export function designCommentRelay(note: string, summary: string, taskTitle: string): string {
  return `${note === '' ? '' : `${note}\n\n`}${summary}\n\n${RELAY_NOTICE}${taskTitle}」。）`;
}

export function isDesignCommentRelay(text: string): boolean {
  return text.includes(`\n\n${RELAY_NOTICE}`) && text.endsWith('」。）');
}

export async function sendDesignComments(
  deps: SendDeps,
  teamId: string,
  body: ChiefSendMessageBody & { designCommentIds: string[] },
): Promise<ReturnType<typeof sendChiefMessageFromComposer>> {
  const rows = deps.db
    .select()
    .from(designComment)
    .where(and(eq(designComment.teamId, teamId), inArray(designComment.id, body.designCommentIds)))
    .orderBy(designComment.pin)
    .all();
  if (rows.length !== new Set(body.designCommentIds).size) {
    throw new HttpError(404, 'design comment not found');
  }
  const todoIds = new Set(rows.map((r) => r.todoId));
  if (todoIds.size !== 1) throw new HttpError(400, 'comments must belong to one task');
  const statuses = new Set(rows.map((r) => r.status));
  const replay =
    statuses.size === 1 &&
    statuses.has('sent') &&
    deps.db
      .select({ id: clientMessage.clientMessageId })
      .from(clientMessage)
      .where(eq(clientMessage.clientMessageId, body.clientMessageId))
      .get() !== undefined;
  if (!replay && (statuses.size > 1 || !statuses.has('open'))) {
    throw new HttpError(409, 'some comments were already sent or resolved');
  }
  const todoRow = requireWritableTodo(deps.db, teamId, rows[0]?.todoId ?? '');
  const marks = rows.flatMap((r) => (r.markAttachmentId === null ? [] : [r.markAttachmentId]));
  const markTokens = new Map(
    (marks.length === 0
      ? []
      : deps.db
          .select({ id: attachment.id, storageKey: attachment.storageKey })
          .from(attachment)
          .where(and(inArray(attachment.id, marks), eq(attachment.teamId, teamId)))
          .all()
    ).map((m) => [m.id, formatAttachmentToken('mark.png', m.storageKey)]),
  );
  const records = recordsOf(deps.db, rows);
  const block = renderDesignCommentBlock({
    todoRef: todoRow.title,
    comments: records,
    markTokens,
  });
  const summary = renderArtifactCommentSummary(records);
  const note = body.content.trim();
  await messageThreadAsUser(
    deps,
    teamId,
    todoRow.id,
    { content: block, clientMessageId: `design:${body.clientMessageId}` },
    { origin: 'coordinator', actor: 'Coordinator' },
  );
  const sent = sendChiefMessageFromComposer(deps, teamId, {
    ...body,
    content: designCommentRelay(note, summary, todoRow.title),
  });
  deps.db
    .update(designComment)
    .set({
      status: 'sent',
      messageId: sent.result.message.id,
      sentAt: nowMs(),
      updatedAt: nowMs(),
    })
    .where(
      and(
        inArray(
          designComment.id,
          rows.map((r) => r.id),
        ),
        eq(designComment.status, 'open'),
      ),
    )
    .run();
  return sent;
}
