// 项目标签集服务面。两形态分叉（#446 / ADR 0005 分叉律）：
// - local/hosted 形态 = 固定词表播种（spec 15 #394 / ADR 0002 D4）：词表 =
//   shared FIXED_TAGS 单源，per 项目成行。调用面：项目创建时播种（routes
//   POST /api/projects、chief create_project 工具）、server 启动时补齐存量
//   项目（index.ts）。幂等 = 按 (projectId, name) 查重，缺谁补谁。
// - github 形态 = 仓库 label 镜像（ADR 0005 D2/D3）：不播种 6 词；导入面
//   每次现拉仓库 label 集按 (projectId, name) upsert（颜色取 GitHub 真值），
//   仓库侧删掉的 label 保留行——删行会经 todo_tag 级联摘掉任务已挂的标签，
//   标签的历史不该被外部仓库改写。
// 两形态共用一条不变式：贴的标签必须在本项目标签集内（tag 表现查）。

import { FIXED_TAGS, TAG_DEFAULT_COLOR } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, tag } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

/** 为单个项目补齐固定词表标签（缺谁补谁）。返回新插入的行数。 */
export function seedFixedTags(db: Db, projectId: string): number {
  const existing = new Set(
    db
      .select({ name: tag.name })
      .from(tag)
      .where(eq(tag.projectId, projectId))
      .all()
      .map((r) => r.name),
  );
  let inserted = 0;
  for (const def of FIXED_TAGS) {
    if (existing.has(def.name)) continue;
    db.insert(tag)
      .values({
        id: newRecordId(),
        projectId,
        name: def.name,
        color: def.color,
        createdAt: nowMs(),
        v: 1,
      })
      .run();
    inserted += 1;
  }
  return inserted;
}

/** 启动补齐：存量项目逐个 seedFixedTags（幂等，空集零动作）。github 形态
 * 跳过——词表 = 仓库 label 镜像，6 词播种会污染真值（ADR 0005 D2）。 */
export function backfillFixedTags(db: Db): void {
  const rows = db.select({ id: project.id, repoKind: project.repoKind }).from(project).all();
  for (const row of rows) {
    if (row.repoKind === 'github') continue;
    seedFixedTags(db, row.id);
  }
}

/** 按词表 name 解析本项目的 tag 行 id（set_task_meta 工具面，local 形态）；
 *  词表外 name 或未播种（启动补齐前的手工建库等边缘）= null，调用面译 400。 */
export function resolveFixedTagId(db: Db, projectId: string, name: string): string | null {
  const row = db
    .select({ id: tag.id })
    .from(tag)
    .where(and(eq(tag.projectId, projectId), eq(tag.name, name)))
    .get();
  return row?.id ?? null;
}

/** GitHub label 颜色归一（#446 / ADR 0005 D3「颜色取 GitHub 的」）：上游
 * 6-hex 无 # → 补 #；已带 # 的合法值小写归一；畸形/缺失 → TAG_DEFAULT_COLOR
 * 兜底（tag.color 列 notNull）。 */
export function normalizeGithubLabelColor(color: string | null | undefined): string {
  if (typeof color === 'string') {
    if (/^[0-9a-fA-F]{6}$/.test(color)) return `#${color.toLowerCase()}`;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();
  }
  return TAG_DEFAULT_COLOR;
}

/** 仓库 label 镜像同步（ADR 0005 D3）：按 (projectId, name) upsert——缺行
 * 建行（色归一）、有行且色不同则更新为 GitHub 真值；**永不删行**（删行经
 * todo_tag 级联摘掉任务已挂标签，标签历史不被外部仓库改写）。幂等：重复
 * 同步零重复行。同名条目后到者覆盖色（调用面按「仓库集 → issue 集」序传，
 * issue 上的更新鲜）。返回 {inserted, updated}。 */
export function syncGithubLabels(
  db: Db,
  projectId: string,
  labels: readonly { name: string; color: string | null }[],
): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  for (const label of labels) {
    const color = normalizeGithubLabelColor(label.color);
    const existing = db
      .select({ id: tag.id, color: tag.color })
      .from(tag)
      .where(and(eq(tag.projectId, projectId), eq(tag.name, label.name)))
      .get();
    if (existing === undefined) {
      db.insert(tag)
        .values({
          id: newRecordId(),
          projectId,
          name: label.name,
          color,
          createdAt: nowMs(),
          v: 1,
        })
        .run();
      inserted += 1;
    } else if (existing.color !== color) {
      db.update(tag).set({ color }).where(eq(tag.id, existing.id)).run();
      updated += 1;
    }
  }
  return { inserted, updated };
}

/** 项目标签集词表（#446 / ADR 0005 D2 的 github 形态取值面）：claim 载荷
 * todo.meta.vocab 的供数——name 列即词表（含义在名字里，仓库真值不加
 * 注释；claim 时现取 DB，不缓存第二真值）。 */
export function listProjectTagVocab(db: Db, projectId: string): { name: string }[] {
  return db.select({ name: tag.name }).from(tag).where(eq(tag.projectId, projectId)).all();
}

/** 按 name 集解析本项目 tag 行（#446 不变式的 github 形态取值面：词表 =
 * 项目标签集全量，不限 FIXED_TAGS）。返回命中 name → tagId 图；缺名不出
 * 现在图里（调用面译 400）。 */
export function resolveProjectTagIds(
  db: Db,
  projectId: string,
  names: readonly string[],
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const name of names) {
    if (resolved.has(name)) continue;
    const row = db
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.projectId, projectId), eq(tag.name, name)))
      .get();
    if (row) resolved.set(name, row.id);
  }
  return resolved;
}
