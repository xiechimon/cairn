import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DESIGN_ARTIFACT_CSP,
  type DesignPageRecord,
  type DesignShareRecord,
  type DesignVersionRecord,
  designSharePath,
  isDesignPageName,
} from '@cairn/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, designComment, designShare, designVersion, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';

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
  if (!isDesignPageName(input.fileName)) return undefined;
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

function requireTodo(db: Db, teamId: string, todoId: string): typeof todo.$inferSelect {
  const row = db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
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
  requireTodo(db, teamId, todoId);
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
      const open = db
        .select({ n: sql<number>`count(*)` })
        .from(designComment)
        .where(
          and(
            eq(designComment.todoId, todoId),
            eq(designComment.fileName, fileName),
            eq(designComment.status, 'open'),
          ),
        )
        .get();
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
        current: versionRecord(db, page.current),
        versionCount: page.count,
        openComments: open?.n ?? 0,
        shareToken: share?.token ?? null,
      };
    });
}

export function listDesignVersions(
  db: Db,
  teamId: string,
  todoId: string,
  fileName: string,
): DesignVersionRecord[] {
  requireTodo(db, teamId, todoId);
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
  const todoRow = requireTodo(db, input.teamId, input.todoId);
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
  version: Pick<VersionRow, 'attachmentId' | 'teamId'>,
): Buffer {
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
  const sandbox = opts.print ? `${DESIGN_PAGE_SANDBOX} allow-modals` : DESIGN_PAGE_SANDBOX;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(body.length),
      'cache-control': 'private, max-age=60',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `${sandbox}; ${DESIGN_ARTIFACT_CSP}; frame-ancestors 'none'`,
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
  requireTodo(db, input.teamId, input.todoId);
  if (currentVersion(db, input.todoId, input.fileName) === undefined) {
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
  requireTodo(db, input.teamId, input.todoId);
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
