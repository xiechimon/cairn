import type { DocumentDiff, DocumentDiffFile } from '@cairn/shared';
import { PLAN_FILE_NAME } from '@cairn/shared';
import { structuredPatch } from 'diff';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { plan as planTable } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

export function planDocumentDiff(
  db: Db,
  documentId: string,
  againstVersion?: number,
): DocumentDiff & { documentId: string } {
  const target = db.select().from(planTable).where(eq(planTable.id, documentId)).get();
  if (!target) throw notFound(`document ${documentId}`);
  const fromVersion = againstVersion ?? Math.max(1, target.version - 1);
  const base = db
    .select()
    .from(planTable)
    .where(and(eq(planTable.buildId, target.buildId), eq(planTable.version, fromVersion)))
    .get();
  if (!base) throw notFound(`document version ${fromVersion} of ${target.buildId}`);
  const diff = computeUnifiedDiff(base.content, target.content, fromVersion, target.version);
  return { documentId, ...diff };
}

export function computeUnifiedDiff(
  oldText: string,
  newText: string,
  fromVersion: number,
  toVersion: number,
): DocumentDiff {
  const patch = structuredPatch(
    `${PLAN_FILE_NAME}@v${fromVersion}`,
    `${PLAN_FILE_NAME}@v${toVersion}`,
    oldText,
    newText,
    '',
    '',
    { context: 3 },
  );
  let additions = 0;
  let deletions = 0;
  const file: DocumentDiffFile = {
    path: PLAN_FILE_NAME,
    additions: 0,
    deletions: 0,
    hunks: patch.hunks.map((h) => {
      const lines = h.lines.map((l) => l);
      for (const l of lines) {
        if (l.startsWith('+')) additions += 1;
        else if (l.startsWith('-')) deletions += 1;
      }
      return {
        header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
        lines,
      };
    }),
  };
  file.additions = additions;
  file.deletions = deletions;
  return { fromVersion, toVersion, files: [file] };
}
