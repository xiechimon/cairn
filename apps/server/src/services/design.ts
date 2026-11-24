import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ArtifactOfAttachment,
  ATTACHMENT_MAX_BYTES,
  artifactKindOf,
  type DesignPageRecord,
  type DesignShareRecord,
  type DesignVersionRecord,
  designSharePath,
  isArtifactName,
  isExcalidrawScene,
} from '@cairn/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, designComment, designShare, designVersion } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { TEAM_ATTACHMENTS_QUOTA_BYTES, teamAttachmentBytes } from './attachment-gc.js';
import { writeAttachmentFile } from './attachments.js';
import { requireTeamTodo } from './tool-guards.js';

type VersionRow = typeof designVersion.$inferSelect;

export interface DesignVersionInput {
  teamId: string;
  todoId: string;
  fileName: string;
  attachmentId: string;
  sha256: string | null;
  createdBy: string;
  createdAt: number;
}

function currentVersion(db: Db, todoId: string, fileName: string): VersionRow | undefined {
  return db
    .select()
    .from(designVersion)
    .where(and(eq(designVersion.todoId, todoId), eq(designVersion.fileName, fileName)))
    .orderBy(desc(designVersion.seq))
    .get();
}

export function recordDesignVersion(db: Db, input: DesignVersionInput): VersionRow | undefined {
  if (!isArtifactName(input.fileName)) return undefined;
  const current = currentVersion(db, input.todoId, input.fileName);
  if (current !== undefined && input.sha256 !== null && current.sha256 === input.sha256) {
    return undefined;
  }
  const row: VersionRow = {
    id: newRecordId(),
    teamId: input.teamId,
    todoId: input.todoId,
    fileName: input.fileName,
    seq: (current?.seq ?? 0) + 1,
    attachmentId: input.attachmentId,
    sha256: input.sha256,
    source: 'agent',
    restoredFromVersionId: null,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  };
  db.insert(designVersion).values(row).run();
  return row;
}

function versionRecord(db: Db, row: VersionRow): DesignVersionRecord {
  const size = db
    .select({ sizeBytes: attachment.sizeBytes })
    .from(attachment)
    .where(eq(attachment.id, row.attachmentId))
    .get();
  const restored =
    row.restoredFromVersionId === null
      ? undefined
      : db
          .select({ seq: designVersion.seq })
          .from(designVersion)
          .where(eq(designVersion.id, row.restoredFromVersionId))
          .get();
  return {
    id: row.id,
    todoId: row.todoId,
    fileName: row.fileName,
    seq: row.seq,
    attachmentId: row.attachmentId,
    sizeBytes: size?.sizeBytes ?? 0,
    source: row.source,
    restoredFromSeq: restored?.seq ?? null,
    createdAt: row.createdAt,
  };
}

export function listDesignPages(db: Db, teamId: string, todoId: string): DesignPageRecord[] {
  requireTeamTodo(db, todoId, teamId);
  const rows = db
    .select()
    .from(designVersion)
    .where(and(eq(designVersion.todoId, todoId), eq(designVersion.teamId, teamId)))
    .orderBy(desc(designVersion.seq))
    .all();
  const pages = new Map<string, { current: VersionRow; count: number }>();
  for (const row of rows) {
    const page = pages.get(row.fileName);
    if (page === undefined) pages.set(row.fileName, { current: row, count: 1 });
    else page.count += 1;
  }
  return [...pages.entries()]
    .sort((a, b) => a[1].current.createdAt - b[1].current.createdAt)
    .map(([fileName, page]) => {
      const share = db
        .select({ token: designShare.token })
        .from(designShare)
        .where(
          and(
            eq(designShare.todoId, todoId),
            eq(designShare.fileName, fileName),
            isNull(designShare.revokedAt),
          ),
        )
        .get();
      return {
        fileName,
        kind: artifactKindOf(fileName),
        current: versionRecord(db, page.current),
        versionCount: page.count,
        openComments: openCommentCount(db, todoId, fileName),
        shareToken: share?.token ?? null,
      };
    });
}

function openCommentCount(db: Db, todoId: string, fileName: string): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(designComment)
      .where(
        and(
          eq(designComment.todoId, todoId),
          eq(designComment.fileName, fileName),
          eq(designComment.status, 'open'),
        ),
      )
      .get()?.n ?? 0
  );
}

export function artifactOfAttachment(
  db: Db,
  teamId: string,
  attachmentId: string,
): ArtifactOfAttachment {
  const version = db
    .select()
    .from(designVersion)
    .where(and(eq(designVersion.attachmentId, attachmentId), eq(designVersion.teamId, teamId)))
    .orderBy(desc(designVersion.seq))
    .get();
  if (!version) throw new HttpError(404, `artifact of attachment ${attachmentId}`);
  const count = db
    .select({ n: sql<number>`count(*)` })
    .from(designVersion)
    .where(
      and(eq(designVersion.todoId, version.todoId), eq(designVersion.fileName, version.fileName)),
    )
    .get();
  return {
    todoId: version.todoId,
    fileName: version.fileName,
    kind: artifactKindOf(version.fileName),
    versionId: version.id,
    versionSeq: version.seq,
    versionCount: count?.n ?? 1,
    openComments: openCommentCount(db, version.todoId, version.fileName),
  };
}

export function listDesignVersions(
  db: Db,
  teamId: string,
  todoId: string,
  fileName: string,
): DesignVersionRecord[] {
  requireTeamTodo(db, todoId, teamId);
  return db
    .select()
    .from(designVersion)
    .where(
      and(
        eq(designVersion.todoId, todoId),
        eq(designVersion.teamId, teamId),
        eq(designVersion.fileName, fileName),
      ),
    )
    .orderBy(desc(designVersion.seq))
    .all()
    .map((row) => versionRecord(db, row));
}

export function restoreDesignVersion(
  db: Db,
  input: { teamId: string; todoId: string; versionId: string; userId: string },
): DesignVersionRecord {
  const todoRow = requireTeamTodo(db, input.todoId, input.teamId);
  if (todoRow.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  const from = db
    .select()
    .from(designVersion)
    .where(
      and(
        eq(designVersion.id, input.versionId),
        eq(designVersion.todoId, input.todoId),
        eq(designVersion.teamId, input.teamId),
      ),
    )
    .get();
  if (!from) throw new HttpError(404, `design version ${input.versionId}`);
  const row = db.transaction(() => {
    const current = currentVersion(db, from.todoId, from.fileName);
    const next: VersionRow = {
      id: newRecordId(),
      teamId: from.teamId,
      todoId: from.todoId,
      fileName: from.fileName,
      seq: (current?.seq ?? 0) + 1,
      attachmentId: from.attachmentId,
      sha256: from.sha256,
      source: 'restore',
      restoredFromVersionId: from.id,
      createdBy: input.userId,
      createdAt: nowMs(),
    };
    db.insert(designVersion).values(next).run();
    return next;
  });
  return versionRecord(db, row);
}

export function saveUserVersion(
  deps: { db: Db; attachmentsDir: string },
  input: { teamId: string; todoId: string; fileName: string; userId: string; content: string },
): DesignVersionRecord {
  const { db } = deps;
  const todoRow = requireTeamTodo(db, input.todoId, input.teamId);
  if (todoRow.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  if (artifactKindOf(input.fileName) !== 'whiteboard') {
    throw new HttpError(400, 'only a whiteboard can be saved from the panel');
  }
  if (currentVersion(db, input.todoId, input.fileName) === undefined) {
    throw new HttpError(404, `artifact ${input.fileName}`);
  }
  if (!isExcalidrawScene(input.content)) throw new HttpError(400, 'not an Excalidraw scene');
  const bytes = Buffer.from(input.content, 'utf8');
  if (bytes.length > ATTACHMENT_MAX_BYTES) {
    throw new HttpError(400, 'the whiteboard exceeds the 10 MiB attachment cap');
  }
  if (teamAttachmentBytes(db, input.teamId) + bytes.length > TEAM_ATTACHMENTS_QUOTA_BYTES) {
    throw new HttpError(413, 'attachment quota exceeded');
  }
  const id = newRecordId();
  const storageKey = `${input.teamId}/${id}.excalidraw`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeAttachmentFile(deps.attachmentsDir, storageKey, bytes);
  try {
    const row = db.transaction(() => {
      const now = nowMs();
      db.insert(attachment)
        .values({
          id,
          teamId: input.teamId,
          todoId: input.todoId,
          sha256,
          createdBy: input.userId,
          fileName: input.fileName,
          mimeType: 'text/plain',
          sizeBytes: bytes.length,
          storageKey,
          grantId: newRecordId(),
          scope: 'design',
          status: 'ready',
          createdAt: now,
        })
        .run();
      const current = currentVersion(db, input.todoId, input.fileName);
      const next: VersionRow = {
        id: newRecordId(),
        teamId: input.teamId,
        todoId: input.todoId,
        fileName: input.fileName,
        seq: (current?.seq ?? 0) + 1,
        attachmentId: id,
        sha256,
        source: 'user',
        restoredFromVersionId: null,
        createdBy: input.userId,
        createdAt: now,
      };
      db.insert(designVersion).values(next).run();
      return next;
    });
    return versionRecord(db, row);
  } catch (error) {
    rmSync(join(deps.attachmentsDir, storageKey), { force: true });
    throw error;
  }
}

export function requireDesignVersion(db: Db, teamId: string, versionId: string): VersionRow {
  const row = db
    .select()
    .from(designVersion)
    .where(and(eq(designVersion.id, versionId), eq(designVersion.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `design version ${versionId}`);
  return row;
}

export function readDesignVersionHtml(
  db: Db,
  attachmentsDir: string,
  version: Pick<VersionRow, 'attachmentId' | 'teamId' | 'fileName'>,
): Buffer {
  if (artifactKindOf(version.fileName) !== 'page') {
    throw new HttpError(404, `design page ${version.fileName}`);
  }
  const file = db
    .select({ storageKey: attachment.storageKey, status: attachment.status })
    .from(attachment)
    .where(and(eq(attachment.id, version.attachmentId), eq(attachment.teamId, version.teamId)))
    .get();
  if (file?.status !== 'ready') throw new HttpError(410, 'design version file is gone');
  try {
    return readFileSync(join(attachmentsDir, file.storageKey));
  } catch {
    throw new HttpError(410, 'design version file is gone');
  }
}

export const DESIGN_PAGE_SANDBOX = 'sandbox allow-scripts allow-forms allow-downloads';
const PRINT_SCRIPT =
  '<script>addEventListener("load",function(){setTimeout(function(){print()},300)})</script>';

export function designPageResponse(html: Buffer, opts: { print: boolean }): Response {
  const body = opts.print ? Buffer.concat([html, Buffer.from(PRINT_SCRIPT)]) : html;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(body.length),
      'cache-control': 'private, max-age=60',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': opts.print
        ? `${DESIGN_PAGE_SANDBOX} allow-modals; frame-ancestors 'none'`
        : `${DESIGN_PAGE_SANDBOX}; frame-ancestors 'none'`,
    },
  });
}

export function relayOrigin(): string | null {
  const value = process.env.CAIRN_RELAY_ORIGIN?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

function liveShare(db: Db, todoId: string, fileName: string) {
  return db
    .select()
    .from(designShare)
    .where(
      and(
        eq(designShare.todoId, todoId),
        eq(designShare.fileName, fileName),
        isNull(designShare.revokedAt),
      ),
    )
    .get();
}

export function createDesignShare(
  db: Db,
  input: { teamId: string; todoId: string; fileName: string; userId: string },
): DesignShareRecord {
  const origin = relayOrigin();
  if (origin === null) throw new HttpError(409, 'a share link needs a relay', 'relay-missing');
  requireTeamTodo(db, input.todoId, input.teamId);
  if (
    artifactKindOf(input.fileName) !== 'page' ||
    currentVersion(db, input.todoId, input.fileName) === undefined
  ) {
    throw new HttpError(404, `design page ${input.fileName}`);
  }
  const row = db.transaction(() => {
    const existing = liveShare(db, input.todoId, input.fileName);
    if (existing !== undefined) return existing;
    const next = {
      id: newRecordId(),
      teamId: input.teamId,
      todoId: input.todoId,
      fileName: input.fileName,
      token: randomBytes(32).toString('base64url'),
      createdBy: input.userId,
      createdAt: nowMs(),
      revokedAt: null,
    };
    db.insert(designShare).values(next).run();
    return next;
  });
  return {
    token: row.token,
    path: `${origin}${designSharePath(row.token)}`,
    createdAt: row.createdAt,
  };
}

export function revokeDesignShare(
  db: Db,
  input: { teamId: string; todoId: string; fileName: string },
): void {
  requireTeamTodo(db, input.todoId, input.teamId);
  db.update(designShare)
    .set({ revokedAt: nowMs() })
    .where(
      and(
        eq(designShare.todoId, input.todoId),
        eq(designShare.teamId, input.teamId),
        eq(designShare.fileName, input.fileName),
        isNull(designShare.revokedAt),
      ),
    )
    .run();
}

export function readSharedPage(db: Db, attachmentsDir: string, token: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const share = db
    .select()
    .from(designShare)
    .where(and(eq(designShare.token, token), isNull(designShare.revokedAt)))
    .get();
  if (share === undefined) return null;
  const current = currentVersion(db, share.todoId, share.fileName);
  if (current === undefined) return null;
  try {
    return readDesignVersionHtml(db, attachmentsDir, current);
  } catch {
    return null;
  }
}
