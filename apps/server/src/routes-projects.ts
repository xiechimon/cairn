// 项目域：项目 CRUD + 标签 + GitHub issue 读/导面 + repo 文件浏览
// （tree/file/files/branches/commits）+ fs/pick·fs/list。
// #1125 拆域：本模块是 routes.ts 的一个资源域切片（词表单源与
// 对拍契约不变——shared WEB_REST_ENDPOINTS + test/wire.test.ts 拍的是组合
// 后的 app，不是文件布局）。编排位 = routes.ts 的 registerRoutes。

import {
  createProjectBodySchema,
  createTagBodySchema,
  type FsListResult,
  type FsPickResult,
  githubIssuesResponseSchema,
  importGithubIssueBodySchema,
  patchProjectBodySchema,
} from '@pacman/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { build, project, tag, todo } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { newRecordId, nowMs } from './lib/ids.js';
import {
  githubIssueDepsOf,
  githubIssuesQuerySchema,
  jsonBody,
  requestOrigin,
  requireProject,
  requireTeam,
  svcOf,
  toTagRecord,
} from './routes-helpers.js';
import { toBuildRecord } from './services/builds.js';
import { listDir } from './services/fs-list.js';
import { pickFolder } from './services/fs-pick.js';
import {
  isGithubRepoRef,
  provisionHostedRepo,
  readBranches,
  readCommitDetail,
  readCommitHistory,
  readFile,
  readFiles,
  readTree,
  slugifyRepoName,
  toProjectRecord,
  uniqueRepoName,
  validateGithubLocalSlotPath,
  validateLocalRepoPath,
} from './services/git.js';
import { importGithubIssue, listProjectGithubIssues } from './services/github-issues.js';
import { deleteProject } from './services/projects.js';
import { seedFixedTags } from './services/tags.js';
import { listTodos } from './services/todos.js';

export function registerProjectRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/projects', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    const origin = requestOrigin(c);
    const rows = ctx.db.select().from(project).where(eq(project.teamId, teamId)).all();
    return c.json(rows.map((r) => toProjectRecord(r, origin)));
  });

  app.get('/api/projects/:id/todos', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(listTodos(svc, { projectId: row.id }));
  });

  app.get('/api/projects/:id/builds', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    // 项目 todo 集下的 build 行（build 无 projectId 列，经 todo 归属投影）。
    const todoIds = ctx.db
      .select({ id: todo.id })
      .from(todo)
      .where(eq(todo.projectId, row.id))
      .all()
      .map((r) => r.id);
    if (todoIds.length === 0) return c.json([]);
    const builds = ctx.db.select().from(build).where(inArray(build.todoId, todoIds)).all();
    return c.json(builds.map(toBuildRecord));
  });

  app.get('/api/projects/:id/tags', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const tags = ctx.db.select().from(tag).where(eq(tag.projectId, row.id)).all();
    return c.json(tags.map(toTagRecord));
  });

  // POST /api/projects/{id}/tags（#309，r9 §3.4 实测 wire：body {name,color}
  // → 201 全 record。color 客户端缺省 #6366f1（TAG_DEFAULT_COLOR），server
  // 不产色。tag 无 PATCH/DELETE 观测面——删除/管理面归项目设置「标签」tab
  // （r9 §3.4，REST 直删 404 实测，不在本票垂直切片）。
  app.post('/api/projects/:id/tags', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(createTagBodySchema, await jsonBody(c), 'body');
    const id = newRecordId();
    ctx.db
      .insert(tag)
      .values({
        id,
        projectId: row.id,
        name: body.name,
        color: body.color,
        createdAt: nowMs(),
        v: 1,
      })
      .run();
    const created = ctx.db.select().from(tag).where(eq(tag.id, id)).get();
    if (!created) throw new Error(`tag ${id} missing after insert`);
    return c.json(toTagRecord(created), 201); // 响应封套 = record 全形（r9 实测）
  });

  // —— GitHub issue 读面（#446 / ADR 0005 读向；自有设计面，02 §6.1 词表外
  // = wire.test INFERRED_ROUTES 入位）。只读，不在 GitHub 留痕迹（写向 =
  // ADR 0006 另票）；token 纪律 = repos 代理同族（openGithubToken 唯一读出
  // 点，Authorization 头唯一消费位）。形态/连接闸与错误语义归
  // services/github-issues.ts。封套单源 = shared githubIssuesResponseSchema。

  app.get('/api/projects/:id/github/issues', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const query = parseWith(
      githubIssuesQuerySchema,
      {
        state: c.req.query('state') ?? 'open',
        page: c.req.query('page') ?? '1',
      },
      'query',
    );
    const face = await listProjectGithubIssues(githubIssueDepsOf(ctx), row, {
      state: query.state,
      page: query.page,
    });
    return c.json(githubIssuesResponseSchema.parse(face));
  });

  // 从 issue 建任务（#446）：现拉 issue 详情 + 镜像同步仓库 label 集 →
  // createTodo（标题原样 / 正文 = body / 多标签 / 来源两列）。201 全
  // TodoRecord（POST todos 面同律）。
  app.post('/api/projects/:id/github/issues/import', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(importGithubIssueBodySchema, await jsonBody(c), 'body');
    const record = await importGithubIssue({ ...svc, ...githubIssueDepsOf(ctx) }, row, body.number);
    return c.json(record, 201);
  });

  // —— repo 文件浏览面（02 §3：读裸库 ref 树与单文件，server 端实现，无检出
  // 要求；服务 `Tasks | Files` 分段开关，r1 §461。响应形状 [推断]）———————————
  // path query = 子目录下钻（#1097）：readTree/lsTree 原生支持（含
  // isSafeRepoPath 守卫），路由层透传即可；缺省/空串 = 顶层（既有语义）。
  app.get('/api/projects/:id/tree', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readTree(ctx, row.id, c.req.query('ref'), c.req.query('path')));
  });

  app.get('/api/projects/:id/file', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const path = c.req.query('path');
    if (path === undefined || path === '') {
      throw new HttpError(400, 'invalid query path: required');
    }
    return c.json(await readFile(ctx, row.id, path, c.req.query('ref')));
  });

  // 全递归文件列举（#760 composer `@` 候选源）：tree 面单层，全仓候选另开
  // 此面。limit 缺省/非法即钳制（渐进增强面，参数宽容不 400）。
  app.get('/api/projects/:id/files', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readFiles(ctx, row.id, c.req.query('ref'), c.req.query('limit')));
  });

  app.get('/api/projects/:id/branches', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readBranches(ctx, row.id));
  });

  // commits 读面（#149 文件|历史 分段「历史」；[推断] 路由，wire.test
  // INFERRED_ROUTES 登记——r2 07e/24 分段 UI 证据、wire 未采）。
  app.get('/api/projects/:id/commits', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readCommitHistory(ctx, row.id, c.req.query('ref')));
  });

  // 提交详情读面（#1102 历史行点击 → 该提交 diff；[推断] 路由，wire.test
  // INFERRED_ROUTES 登记——projects/{id}/commits/{sha} REST 同族规则）。
  // sha 位宽容任意 ref 样串：resolveCommitOr404 解析失败一律 404（注入形
  // 不过缝，services/git.ts readCommitDetail 头注 S3）。
  app.get('/api/projects/:id/commits/:sha', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readCommitDetail(ctx, row.id, c.req.param('sha')));
  });

  app.post('/api/projects', async (c) => {
    // [推断] REST 同名（02 §6.1 POST 面未观测；项目创建流两分支 UI 证据 02 §3/r2 §9）。
    // body 单源 = shared createProjectBodySchema（spec 12 数据契约面 kind /
    // localPath / githubRepo{owner,repo} + 既有 wire 面 repoKind / githubRepo
    // 字符串；双名并存 kind 优先，皆缺 = 无 repo 普通项目）。
    const body = parseWith(createProjectBodySchema, await jsonBody(c), 'body');
    const teamId = body.teamId ?? ctx.team.id;
    requireTeam(ctx, teamId);
    const kind = body.kind ?? body.repoKind;
    let githubRepo: string | null = null;
    if (kind === 'github') {
      // 双面归一（对象面 = picker 回填，字符串面 = 手动兜底）→ 同一 400 闸。
      const ref =
        typeof body.githubRepo === 'string'
          ? body.githubRepo
          : body.githubRepo
            ? `${body.githubRepo.owner}/${body.githubRepo.repo}`
            : undefined;
      if (ref === undefined || !isGithubRepoRef(ref)) {
        throw new HttpError(400, 'invalid body at githubRepo: expected "owner/repo"');
      }
      githubRepo = ref;
    } else if (kind === 'local' && body.githubRepo !== undefined) {
      // local 形态语义不变（ADR 0017 决策 2）：无 githubRepo 槽——带键显式拒，
      // 不静默吞（吞了用户会以为接上了 GitHub 真值）。
      throw new HttpError(400, 'invalid body at githubRepo: not allowed for kind "local"');
    }
    // local 形态：localPath 三态校验 400 闸（services/git.ts，spec 12 / #359）。
    // github 形态：localPath = 同机加速位（ADR 0017 / #1213）——server 只做
    // 形态校验（绝对路径），存在性 / git 仓判定归 daemon（路径可能活在执行
    // 机上，server 看不见；失格静默回落 GitHub clone）。
    const localPath =
      kind === 'local'
        ? await validateLocalRepoPath(body.localPath)
        : kind === 'github'
          ? validateGithubLocalSlotPath(body.localPath)
          : null;
    const id = newRecordId();
    let repoName: string | null = null;
    if (kind === 'hosted') {
      // 托管形态落地：init 本地 bare repo（02 §3 锁定）。
      repoName = await uniqueRepoName(ctx, teamId, slugifyRepoName(body.name));
      await provisionHostedRepo(ctx, teamId, repoName);
    }
    ctx.db
      .insert(project)
      .values({
        id,
        name: body.name,
        teamId,
        repoKind: kind ?? null,
        repoName,
        githubRepo,
        localPath,
      })
      .run();
    // spec 15 #394：固定标签词表随项目播种（ADR 0002 D4；幂等，chief
    // create_project 面同调）。github 形态跳过——词表 = 仓库 label 镜像
    // （#446 / ADR 0005 D2，导入面现拉同步），6 词播种会污染真值。
    if (kind !== 'github') seedFixedTags(ctx.db, id);
    const row = requireProject(ctx, id);
    return c.json(toProjectRecord(row, requestOrigin(c)), 201);
  });

  // PATCH /api/projects/{id}（ADR 0017 / #1213）：localPath 加速位写面。
  // body 单源 = shared patchProjectBodySchema；单字段语义：缺键 = 不动（与
  // null 的显式清空两态分离——null 是 wire 契约，不是「不带键」，#1169
  // 序列化坑族）；null / 空串 = 清空；字符串 = 落值（server 只验绝对路径
  // 形态，可达性判定归 daemon）。仅 github 形态消费本字段——local 形态的
  // localPath 是创建闸的仓绑定，不经本面改写；非 github 形态带键 400。
  app.patch('/api/projects/:id', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(patchProjectBodySchema, await jsonBody(c), 'body');
    if (body.localPath === undefined) {
      return c.json(toProjectRecord(row, requestOrigin(c)));
    }
    if (row.repoKind !== 'github') {
      throw new HttpError(
        400,
        'invalid body at localPath: localPath acceleration slot only applies to github projects',
      );
    }
    const localPath = validateGithubLocalSlotPath(body.localPath);
    ctx.db.update(project).set({ localPath }).where(eq(project.id, row.id)).run();
    const updated = requireProject(ctx, row.id);
    return c.json(toProjectRecord(updated, requestOrigin(c)));
  });

  // POST /api/fs/pick（ADR 0003 / #440）：server 代弹 macOS 原生选文件夹
  // 对话框（浏览器拿不到绝对路径，只能目标机进程代弹）。200 {path} = 选中；
  // 200 {path:null} = 用户取消（正常结局非错误面）；422 unavailable / 409
  // busy 带 reason（词汇单源 = shared FS_PICK_ERROR_REASONS，#386 模式）。
  app.post('/api/fs/pick', async (c) => {
    const path = await pickFolder();
    return c.json({ path } satisfies FsPickResult);
  });

  // GET /api/fs/list（ADR 0003 D5/D6 / #441）：应用内目录浏览数据源——
  // remote/headless 形态下 fs/pick 422 unavailable 的兜底浏览器。只列目录 +
  // git 提示标记 + 容量闸；dir 缺省/空串 = server $HOME 起点；400 带 reason
  // （词汇单源 = shared FS_LIST_ERROR_REASONS，#386 模式）。
  app.get('/api/fs/list', (c) => {
    const result = listDir(c.req.query('dir'));
    return c.json(result satisfies FsListResult);
  });

  // 删项目（#189 删除区复活前置）：级联语义单源 = services/projects.ts 头注；
  // 危险操作区删除流 UI 证据 r2 24c，wire 未采（INFERRED_ROUTES 登记）。
  app.delete('/api/projects/:id', (c) => {
    const id = c.req.param('id');
    if (!deleteProject({ db: ctx.db, reposDir: ctx.reposDir }, id)) {
      throw notFound(`project ${id}`);
    }
    return c.body(null, 204);
  });
}
