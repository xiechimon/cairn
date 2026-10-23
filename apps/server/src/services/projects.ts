// 项目写面：PATCH 身份/形态（#1242）+ DELETE 级联（#189）。
// PATCH（#1242 五字段）取舍（PR 同文）：
// - 静默 no-op 族判死：strict schema 杀未知键（400）；五键全缺同样 400——
//   「成功必有过改动」是本面的诚实底线（#1213 时代 routes 层缺键早退的
//   覆辙不再）。
// - 转换只支持 local→github：反向禁、hosted 禁、普通项目（repoKind null）
//   禁——皆 400 明示；githubRepo 只在转换面写（独立 githubRepo 键 = 400，
//   已接好的仓不经本面改写）。
// - 在飞 build 闸（票面失败方式 1）：转换必须发生在无在飞步的静止点——
//   claim 的 repo 派生是 projectRepoRef 现读行（machines.ts），步进行中切
//   形态会让同一 build 的后续步 clone 到另一个源。判据 = 项目 build 集下
//   step.status ∈ pending/claimed/waiting_quota（builds.ts 停止面同词表；
//   waiting_quota 是挂起非终态，重领在即）。改名无此闸——名称纯显示面。
// - localPath 两条件闸不可绕（票面失败方式 2）：转换面与既有加速位写面
//   同函数 validateGithubLocalSlotPath（services/git.ts）。转换缺键 = 保留
//   原值——local 创建闸绑定的仓路径就地转为加速位（用户 2026-10-11 定案
//   「原 cairn 项目转 github 形态 + localPath 加速位」的落点）；null =
//   清空。
// - githubRepo 可达性（票面改法）：GET /repos/{o}/{r} 经 lib/github 薄桥
//   （token = openGithubToken 唯一读出点，无连接 = 匿名梯）；404 → 400，
//   限流/网络沿 429/502 上抛。
// - 注记（板面可见）：真改名/转换成功后，项目各 todo（latestBuildId 非空）
//   的会话各落一条 system 纯文本行（transcript note 形；文本单源 = shared
//   projectRenamedNote/projectConvertedNote）。项目无会话级注记宿主——
//   todo 最新会话即「board 项目历史」的可见面；无 build 的 todo 无宿主
//   不落行。同名改名 = 无语义变更，不写注记。
// - 删除面取舍（级联语义设计点，PR 同文）：
//   - 级联删，非拒绝非空——危险操作区 = 单确认语义（web 复活票 DeleteConfirm
//     家族 + invalidateAll，#172 Notes 正典）；拒绝非空要求的逐 todo 手删 UI
//     不存在，会把删除区变成事实死钮。
//   - 清图序（事务内）：step（无 FK，deleteTodo 同款手动清）→ schedule（无
//     FK 列，免孤儿触发位——scheduler 触发面自愈是兜底不是语义）→ tag →
//     todo（FK cascade 随行 build/plan/todo_tag）→ chief watch 摘除（watches
//     = JSON 列无 FK，陈旧 watch 不自愈；不借 removeChiefWatches——其
//     ensureChief create-on-read 会在删除路径凭空建行，且只覆盖单 chief 行）
//     → agentMemory.projectId 置 null（记忆 = Agent 资产，agentId+teamId 键、
//     projectId 可空作用域：清作用域指针留知识本体；sourceTodoId/
//     sourceBuildId 溯源槽悬空 = deleteTodo 既有面同口径）→ project 行。
//   - message/tokenUsage 无 FK 孤儿行 = deleteTodo 既有面同口径保留（清运面
//     归后票 GC，不在本票扩面；document_diff 已随 #1029 死 schema 退役删表）。
//   - 托管 bare repo 磁盘面随行清（removeHostedRepoDir，services/git.ts 与
//     provisionHostedRepo 对偶位）；库面先落、磁盘后清——rm 失败不吞（500
//     实情），force 幂等（目录缺位不阻断删除）。
//   - 不发 SSE 文档事件：deleteTodo 同律无发布；web 复活票走 invalidateAll
//     客户端重取（#172 Notes 正典）。

import type { PatchProjectBody, SecretBox } from '@cairn/shared';
import { projectConvertedNote, projectRenamedNote } from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentMemory, build, chief, project, schedule, step, tag, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { githubRepoReachable } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { ConversationStreamHub } from './events.js';
import { isGithubRepoRef, removeHostedRepoDir, validateGithubLocalSlotPath } from './git.js';
import { openGithubToken } from './github-connection.js';
import { insertMessageRow } from './transcript.js';

export interface ProjectDeps {
  db: Db;
  reposDir: string;
}

/** PATCH /api/projects/{id} 依赖（#1242）：GitHub 出站缝（ctx.githubFetch
 *  注入位，缺省 globalThis.fetch）+ SecretBox（openGithubToken 解封）+
 *  convHub（注记行即时推送，缺省无会话流面）。 */
export interface ProjectPatchDeps {
  db: Db;
  box: SecretBox;
  githubFetch?: FetchLike;
  convHub?: ConversationStreamHub;
}

/** 在飞步状态词表（builds.ts 停止面同族：挂起/已领/排队都不是静止点）。 */
const IN_FLIGHT_STEP_STATUSES = ['pending', 'claimed', 'waiting_quota'] as const;

/** DELETE /api/projects/{id}（[推断] REST 同名 DELETE；危险操作区删除流 UI
 * 证据 r2 24c，wire 未采——登记 wire.test.ts INFERRED_ROUTES）。返回是否存在
 * 并删除。 */
export function deleteProject(deps: ProjectDeps, id: string): boolean {
  const { db } = deps;
  const row = db.select().from(project).where(eq(project.id, id)).get();
  if (!row) return false;
  const todoIds = db
    .select({ id: todo.id })
    .from(todo)
    .where(eq(todo.projectId, id))
    .all()
    .map((r) => r.id);
  const buildIds =
    todoIds.length > 0
      ? db
          .select({ id: build.id })
          .from(build)
          .where(inArray(build.todoId, todoIds))
          .all()
          .map((r) => r.id)
      : [];
  db.transaction((tx) => {
    if (buildIds.length > 0) tx.delete(step).where(inArray(step.buildId, buildIds)).run();
    tx.delete(schedule).where(eq(schedule.projectId, id)).run();
    tx.delete(tag).where(eq(tag.projectId, id)).run();
    if (todoIds.length > 0) tx.delete(todo).where(inArray(todo.id, todoIds)).run();
    // chief watch 摘除（全 chief 行扫——单用户 seed 现实下行数恒 ≤1）
    for (const chiefRow of tx.select().from(chief).where(eq(chief.teamId, row.teamId)).all()) {
      const next = chiefRow.watches.filter((w) => !todoIds.includes(w.todoId));
      if (next.length !== chiefRow.watches.length) {
        tx.update(chief).set({ watches: next }).where(eq(chief.id, chiefRow.id)).run();
      }
    }
    tx.update(agentMemory).set({ projectId: null }).where(eq(agentMemory.projectId, id)).run();
    tx.delete(project).where(eq(project.id, id)).run();
  });
  // 磁盘面在库面之后：库删成而 rm 败 = 孤儿目录（uniqueRepoName 不查，唯一害
  // 是同名复建拿到原名时 reinit 旧库——500 实情上抛，不吞）。
  if (row.repoKind === 'hosted' && row.repoName !== null) {
    removeHostedRepoDir(deps.reposDir, row.teamId, row.repoName);
  }
  return true;
}

// —— PATCH /api/projects/{id}（#1242 五字段身份/形态写面）——————————————————

type ProjectRow = typeof project.$inferSelect;

/** 解析后的转换面（repoKind==='github' 携带）。 */
interface ConversionInput {
  githubRepo: string;
  localPath: string | null | undefined;
}

/** PATCH 语义解析 + 执法。返回更新后的行（含 note 落库副作用）；不存在 =
 *  null（路由层 404）。所有拒绝路径都是显式 HttpError（400/409）——本面
 * 无静默分支。 */
export async function updateProject(
  deps: ProjectPatchDeps,
  id: string,
  body: PatchProjectBody,
): Promise<ProjectRow | null> {
  const { db } = deps;
  const row = db.select().from(project).where(eq(project.id, id)).get();
  if (row === undefined) return null;

  // 五键全缺 = 静默 no-op 族（#1213 覆辙）——显式 400。
  const carriesKey =
    body.name !== undefined ||
    body.description !== undefined ||
    body.repoKind !== undefined ||
    body.githubRepo !== undefined ||
    body.localPath !== undefined;
  if (!carriesKey) {
    throw new HttpError(
      400,
      'invalid body: nothing to update (at least one of name/description/repoKind/githubRepo/localPath)',
    );
  }

  // name：trim 非空（名称不是可清空字段）。
  const name = body.name !== undefined ? body.name.trim() : undefined;
  if (name !== undefined && name === '') {
    throw new HttpError(400, 'invalid body at name: required non-empty');
  }

  // 转换面解析：repoKind 只支持 'github' 目标，且要求 local 起点。
  let conversion: ConversionInput | undefined;
  if (body.repoKind !== undefined) {
    if (body.repoKind !== 'github') {
      throw new HttpError(
        400,
        `invalid body at repoKind: kind conversion only supports local→github, got "${body.repoKind}"`,
      );
    }
    if (row.repoKind === 'github') {
      throw new HttpError(400, 'invalid body at repoKind: project is already github');
    }
    if (row.repoKind !== 'local') {
      throw new HttpError(
        400,
        `invalid body at repoKind: kind conversion only supports local→github, got "${row.repoKind ?? 'plain'}" project`,
      );
    }
    if (body.githubRepo === undefined || !isGithubRepoRef(body.githubRepo)) {
      throw new HttpError(
        400,
        'invalid body at githubRepo: expected "owner/repo" for kind conversion',
      );
    }
    conversion = { githubRepo: body.githubRepo, localPath: body.localPath };
  } else if (body.githubRepo !== undefined) {
    // githubRepo 只在转换面写：已接好的仓不经本面改写。
    throw new HttpError(
      400,
      'invalid body at githubRepo: only changeable via local→github kind conversion (carry repoKind)',
    );
  }

  // localPath：非转换面维持 #1213 语义（仅 github 形态消费）；转换面三态
  // （缺键 = 保留原 local 绑定 → 加速位；null = 清空；字符串 = 同闸落值）。
  let localPath: string | null | undefined;
  if (conversion !== undefined) {
    localPath =
      conversion.localPath === undefined
        ? row.localPath
        : validateGithubLocalSlotPath(conversion.localPath);
  } else if (body.localPath !== undefined) {
    if (row.repoKind !== 'github') {
      throw new HttpError(
        400,
        'invalid body at localPath: localPath acceleration slot only applies to github projects',
      );
    }
    localPath = validateGithubLocalSlotPath(body.localPath);
  }

  // 转换前置闸（票面失败方式 1）：在飞 build 时 cloneUrl 派生切换会打断进行
  // 中的步——409。改名/描述无此闸（纯显示面）。
  if (conversion !== undefined) {
    await assertNoInFlightBuilds(db, id);
    // 可达性（票面改法）：404 → 400；限流/网络沿 429/502 上抛。owner/repo
    // 拆段形状由上方 isGithubRepoRef 闸保证（恰一斜杠）。
    const slash = conversion.githubRepo.indexOf('/');
    const owner = conversion.githubRepo.slice(0, slash);
    const repo = conversion.githubRepo.slice(slash + 1);
    const token = openGithubToken({ db, box: deps.box }, row.teamId);
    const fetchImpl = deps.githubFetch ?? fetch;
    const reachable = await githubRepoReachable(fetchImpl, token, owner, repo);
    if (!reachable) {
      throw new HttpError(
        400,
        `invalid body at githubRepo: repository not reachable: ${conversion.githubRepo}`,
      );
    }
  }

  // description：null / 空白 = 清空（空 ≡ null，与 localPath 同口径）。
  const description =
    body.description !== undefined
      ? body.description !== null && body.description.trim() !== ''
        ? body.description
        : null
      : undefined;

  const nextName = name ?? row.name;
  const nextRepoKind = conversion !== undefined ? 'github' : row.repoKind;
  const nextGithubRepo = conversion !== undefined ? conversion.githubRepo : row.githubRepo;
  const nextLocalPath = localPath !== undefined ? localPath : row.localPath;
  const nextDescription = description !== undefined ? description : row.description;
  db.update(project)
    .set({
      name: nextName,
      repoKind: nextRepoKind,
      githubRepo: nextGithubRepo,
      localPath: nextLocalPath,
      description: nextDescription,
    })
    .where(eq(project.id, id))
    .run();

  // 注记面（板面可见）：真改名 / 转换 → 项目各 todo 最新会话各落一条 system
  // 行。同名改名（name 未变）= 无语义变更，不写。
  const renamed = name !== undefined && name !== row.name;
  if (renamed || conversion !== undefined) {
    const note =
      conversion !== undefined
        ? projectConvertedNote({ githubRepo: conversion.githubRepo, localPath: nextLocalPath })
        : projectRenamedNote({ from: row.name, to: nextName });
    insertProjectNote(deps, id, note);
  }

  const updated = db.select().from(project).where(eq(project.id, id)).get();
  if (updated === undefined) throw new Error(`project ${id} missing after update`);
  return updated;
}

/** 在飞 build 探测（项目 todo 集 → build 集 → 非终态步）。 */
async function assertNoInFlightBuilds(db: Db, projectId: string): Promise<void> {
  const todoIds = db
    .select({ id: todo.id })
    .from(todo)
    .where(eq(todo.projectId, projectId))
    .all()
    .map((r) => r.id);
  if (todoIds.length === 0) return;
  const buildIds = db
    .select({ id: build.id })
    .from(build)
    .where(inArray(build.todoId, todoIds))
    .all()
    .map((r) => r.id);
  if (buildIds.length === 0) return;
  const inflight = db
    .select({ buildId: step.buildId })
    .from(step)
    .where(and(inArray(step.buildId, buildIds), inArray(step.status, [...IN_FLIGHT_STEP_STATUSES])))
    .all();
  if (inflight.length > 0) {
    throw new HttpError(
      409,
      `kind conversion blocked: project has in-flight builds (${inflight.length} active step${inflight.length > 1 ? 's' : ''}); wait for runs to finish or stop them first`,
    );
  }
}

/** 项目注记 fan-out：latestBuildId 非空的 todo 各自会话落一条 system 纯文本
 *  行（transcript note 形；convHub 即时推送——在线的卡详情当场可见）。 */
function insertProjectNote(deps: ProjectPatchDeps, projectId: string, content: string): void {
  const rows = deps.db
    .select({ latestBuildId: todo.latestBuildId })
    .from(todo)
    .where(eq(todo.projectId, projectId))
    .all();
  const conversationIds = rows.map((r) => r.latestBuildId).filter((v): v is string => v !== null);
  for (const conversationId of conversationIds) {
    insertMessageRow(deps, conversationId, {
      id: newRecordId(),
      role: 'system',
      content,
      createdAt: nowMs(),
    });
  }
}
