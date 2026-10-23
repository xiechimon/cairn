// 文档 diff 面（02 §4.2/r5 §4：plan 即文件 plan.md，版本 = 文件版本；驳回 →
// v2 + plan.md 文件级 unified diff，端点 GET /api/documents/{id}/diff）。
// document_diff 记录形状 = shared documentDiffSchema（{fromVersion,toVersion,
// files:[{path,additions,deletions,hunks:[{header,lines}]}]}）。
// diff 计算 = npm `diff`（01 §4.1「npm diff 算数据」，pin 9.0.0）；wire 响应
// 形状未实测（r5 §4 UI 触点为靶），hunks 结构 = structuredPatch 投影 [推断]。

import type { DocumentDiff, DocumentDiffFile } from '@cairn/shared';
import { PLAN_FILE_NAME } from '@cairn/shared';
import { structuredPatch } from 'diff';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { plan as planTable } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

/** GET /api/documents/{id}/diff——{id} = plan 文档 id（= build.planDocId =
 * 某版 plan 行 id）。默认对比该版与其前一版（r5 §4 `v1 → v2`）；`againstVersion`
 * 显式指定对照版（版本下拉 `与其他版本对比…`/`上一版本` 二级菜单面）。 */
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

/** unified diff → documentDiffSchema（单文件 plan.md；hunk header
 * `@@ -a,b +c,d @@` = r5 §4 实测形，structuredPatch 原样）。 */
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
        // hunk 行只有 ' '、'+'、'-'、'\' 四种前缀；+++/--- 文件头不在 structuredPatch 这一层。
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
