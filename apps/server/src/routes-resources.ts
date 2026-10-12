// 资源域：mcp-servers 读面 / documents diff / 定时 / 搜索 / 机器与能力读面 /
// 技能 / whats-new / 密钥三面（provider·secret·apiKey）/ OAuth 握手 /
// GitHub 连接与 repos 代理。
// #1125 拆域：本模块是 routes.ts 的一个资源域切片（词表单源与
// 对拍契约不变——shared WEB_REST_ENDPOINTS + test/wire.test.ts 拍的是组合
// 后的 app，不是文件布局）。编排位 = routes.ts 的 registerRoutes。

import {
  capabilitiesResponseSchema,
  createProviderBodySchema,
  createScheduleBodySchema,
  createSkillBodySchema,
  evacuateMachineBodySchema,
  githubReposResponseSchema,
  importSkillBodySchema,
  PHASE_VALUES,
  patchMachineBodySchema,
  patchProviderBodySchema,
  SKILL_ENTRY_FILE,
  setSecretBodySchema,
  skillRecordSchema,
  THINKING_LEVELS,
} from '@pacman/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { agent, machine, provider, todo, whatsNew } from './db/schema.js';
import { conflict, HttpError, notFound, parseWith } from './lib/errors.js';
import { githubUserRepos } from './lib/github.js';
import {
  createApiKeyBodySchema,
  jsonBody,
  patchSecretBodySchema,
  requireTeam,
  svcOf,
} from './routes-helpers.js';
import { createApiKey, listApiKeys } from './services/api-keys.js';
import { homeMachineRejectReason } from './services/dispatch-eligibility.js';
import { planDocumentDiff } from './services/documents.js';
import {
  deleteGithubConnection,
  openGithubToken,
  readGithubConnectionStatus,
} from './services/github-connection.js';
import { machineRunningCount, toMachineRecord } from './services/machines.js';
import { listMcpServers } from './services/mcp-servers.js';
import {
  abortOAuthCallback,
  completeOAuthCallback,
  type OAuthDeps,
  OAuthFlowError,
  type OAuthStateKind,
  startGithubConnectionAuthorize,
  startOAuthAuthorize,
} from './services/oauth.js';
import {
  createProvider,
  deleteProvider,
  getModelSources,
  getProvidersEnvelope,
  updateProvider,
} from './services/providers.js';
import { createSchedule, deleteSchedule, listSchedules } from './services/schedules.js';
import { search } from './services/search.js';
import { createSecret, deleteSecret, listSecrets, updateSecret } from './services/secrets.js';
import { importSkill, refreshSkill, type SkillImportOpts } from './services/skill-import.js';
import {
  createLocalSkill,
  listSkillFiles,
  readSkillFile,
  resolveLocalSkill,
  scanLocalSkills,
  updateLocalSkill,
} from './services/skills.js';

export function registerResourceRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  /** #1170 导入/refresh 服务参数（两路由共用；出站注入位走 ctx 缝）。 */
  const importOpts = (teamId: string): SkillImportOpts => ({
    db: ctx.db,
    skillsDir: ctx.skillsDir,
    skillSourcesPath: ctx.skillSourcesPath,
    teamId,
    actor: { type: 'member', id: ctx.user.id },
    fetch: ctx.skillImportFetch ?? globalThis.fetch,
    ...(ctx.skillImportTimeoutMs !== undefined ? { timeoutMs: ctx.skillImportTimeoutMs } : {}),
  });

  // —— 团队 MCP server 读面（spec 13/#368 本地 config 只读制：数据源 =
  // server 本机 ~/.claude.json 投影；管理写面 POST/PATCH/DELETE 已随登记制
  // 删除——配置变更 = 直接编辑 config 文件）—————————————————————————
  app.get('/api/teams/:id/mcp-servers', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listMcpServers({ mcpConfigPath: ctx.mcpConfigPath }, teamId));
  });

  // —— plan.md 版本文档 diff（02 §4.2/r5 §4：documents/{id}/diff 词表内）——————
  app.get('/api/documents/:id/diff', (c) => {
    const against = c.req.query('againstVersion');
    const diff = planDocumentDiff(
      ctx.db,
      c.req.param('id'),
      against !== undefined && against !== '' ? Number(against) : undefined,
    );
    return c.json(diff);
  });

  // —— 定时面（02 §9.2/r3 §9；record = shared scheduleRecordSchema）————————————
  app.get('/api/schedules', (c) => {
    // 查询参数名 `team`（02 §6.1 `schedules?team=` 实测原样）。
    const teamId = c.req.query('team') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    return c.json(listSchedules(svc, teamId));
  });

  app.post('/api/schedules', async (c) => {
    const body = parseWith(createScheduleBodySchema, await jsonBody(c), 'body');
    // 响应封套 [推断]：201 全记录（record 形状 = r3 §8.3 实测原样）。
    const record = createSchedule(svc, {
      ...body,
      teamId: ctx.team.id,
      createdBy: ctx.user.id,
    });
    return c.json(record, 201);
  });

  app.delete('/api/schedules/:id', (c) => {
    const id = c.req.param('id');
    if (!deleteSchedule(svc, id)) throw notFound(`schedule ${id}`);
    return c.body(null, 204);
  });

  // —— ⌘K 搜索（02 §6.3 [设计] 自设；wire 无外部真值，面板行为对 r2 04）———————
  app.get('/api/search', (c) =>
    c.json(search(svc, { teamId: ctx.team.id, q: c.req.query('q') ?? null })),
  );

  app.get('/api/teams/:id/machines', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const rows = ctx.db.select().from(machine).where(eq(machine.teamId, id)).all();
    // #1108 runningSteps 派生随行（机器页「执行中 n/N」数据源）。
    return c.json(rows.map((r) => toMachineRecord(r, machineRunningCount(ctx.db, r.id))));
  });

  // per-runtime 开关写回（spec 11 A8/A9，#357）：enabledRuntimes 全量替换；
  // 词表外 runtime = 400（shared patchMachineBodySchema 钉 MACHINE_RUNTIMES）。
  // XMON-108 R1：shellEnabled 透传——两字段各自缺省 = 不变（单字段 PATCH 不
  // 撞掉另一字段），开关消费面 = claim 组装 + 每调用预检（机器详情页关掉秒级
  // 拒下一条命令，非 claim 期一次闸）。
  // #1108 maxConcurrent：并发上限写位（值域 1..16 = shared schema 钉，越界
  // 400）；下调不抢占在飞步——两侧闸只挡新认领，语义 =「跑完这批再收窄」。
  app.patch('/api/machines/:id', async (c) => {
    const id = c.req.param('id');
    const row = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!row) throw notFound(`machine ${id}`);
    requireTeam(ctx, row.teamId);
    const body = parseWith(patchMachineBodySchema, await jsonBody(c), 'body');
    const patch = {
      ...(body.enabledRuntimes !== undefined ? { enabledRuntimes: body.enabledRuntimes } : {}),
      ...(body.shellEnabled !== undefined ? { shellEnabled: body.shellEnabled } : {}),
      ...(body.maxConcurrent !== undefined ? { maxConcurrent: body.maxConcurrent } : {}),
    };
    // 全字段缺省 = no-op PATCH（空 set 是非法 SQL，且无变更可写）。
    if (Object.keys(patch).length > 0) {
      ctx.db.update(machine).set(patch).where(eq(machine.id, id)).run();
    }
    const updated = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!updated) throw notFound(`machine ${id}`);
    return c.json(toMachineRecord(updated, machineRunningCount(ctx.db, id)));
  });

  // —— #1259 机器生命周期出口：删机保护 + 整机迁移 ————————————————————
  // 删机：有绑定 agent 的机器拒删（409 点名占用清单；agent.machineId 的 FK
  // 是结构兜底，人话出口在这里）。
  app.delete('/api/machines/:id', (c) => {
    const id = c.req.param('id');
    const row = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!row) throw notFound(`machine ${id}`);
    requireTeam(ctx, row.teamId);
    const holders = ctx.db
      .select({ id: agent.id, displayName: agent.displayName })
      .from(agent)
      .where(eq(agent.machineId, id))
      .all();
    if (holders.length > 0) {
      throw conflict(
        `机器「${row.name}」上有 ${holders.length} 个 agent 的归属机是它（${holders
          .map((h) => h.displayName)
          .join('、')}）——先换绑或整机迁移，再删除。`,
      );
    }
    ctx.db.delete(machine).where(eq(machine.id, id)).run();
    return c.body(null, 204);
  });

  // 整机迁移（机器退役出口）：源机全部 agent 改绑目标机，逐个过归属机校验
  // （runtime 开没开 + claude-code 模型配没配，单源 = homeMachineRejectReason）。
  // 部分迁移合法：合格的移、拒的留原机并列明原因（人逐项处置）。
  app.post('/api/machines/:id/evacuate', async (c) => {
    const id = c.req.param('id');
    const src = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!src) throw notFound(`machine ${id}`);
    requireTeam(ctx, src.teamId);
    const body = parseWith(evacuateMachineBodySchema, await jsonBody(c), 'body');
    if (body.targetMachineId === id) {
      throw new HttpError(400, '源机器与目标机相同——无操作不是迁移。');
    }
    const dst = ctx.db
      .select()
      .from(machine)
      .where(and(eq(machine.id, body.targetMachineId), eq(machine.teamId, src.teamId)))
      .get();
    if (!dst) throw notFound(`machine ${body.targetMachineId}`);
    const holders = ctx.db.select().from(agent).where(eq(agent.machineId, id)).all();
    const moved: string[] = [];
    const rejected: { agentId: string; reason: string }[] = [];
    for (const a of holders) {
      const reject = homeMachineRejectReason(dst, a);
      if (reject !== null) {
        rejected.push({ agentId: a.id, reason: reject });
        continue;
      }
      ctx.db.update(agent).set({ machineId: dst.id }).where(eq(agent.id, a.id)).run();
      moved.push(a.id);
    }
    return c.json({ moved, rejected });
  });

  // 能力读面（XMON-16 / #499 B3 裁决 A；[设计] 面，参考产品 wire 未采此端点）：
  // 引擎能力词表送 web 的那一条。当前载荷 = 思考强度档位——web 的 Agent 详情
  // 只读行按它呈现档位，不自己另存一份七档常量。真值单源 = shared
  // `THINKING_LEVELS`（daemon 的 PI_CAPABILITIES 引同一个数组）；server 读不到
  // daemon，故编排面 = shared 常量直出，不经机器上报。队无关：能力是引擎的
  // 事实，不随团队分叉。
  app.get('/api/capabilities', (c) => {
    return c.json(capabilitiesResponseSchema.parse({ thinkingLevels: THINKING_LEVELS }));
  });

  // 模型选项面（02 §6.2「model = Provider 下的具名可选项」；provider.models
  // JSON 列聚合投影 [推断]——wire 未采，配置面下拉/Agent 模型槽数据源）。
  app.get('/api/teams/:id/models', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const rows = ctx.db.select().from(provider).where(eq(provider.teamId, id)).all();
    const models = rows.flatMap((r) =>
      r.models.map((m) => ({ ...m, providerId: r.providerId, providerLabel: r.label })),
    );
    return c.json(models);
  });

  // 进度面（词表内；载荷未采 [推断] = todo 计数按 phase 投影，用量/进度屏
  // 数据源，02 §6.1）。
  app.get('/api/teams/:id/progress', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const rows = ctx.db.select({ phase: todo.phase }).from(todo).where(eq(todo.teamId, id)).all();
    const byPhase: Record<string, number> = Object.fromEntries(PHASE_VALUES.map((p) => [p, 0]));
    for (const r of rows) byPhase[r.phase] = (byPhase[r.phase] ?? 0) + 1;
    return c.json({ todos: { total: rows.length, byPhase } });
  });

  // —— 技能面（spec 13 #367：本地目录现扫投影，不入库无缓存；词表内 GET
  // /api/skills?teamId=、GET teams/{id}/skills/{sid}(+/file?fileName=)；
  // record = shared skillRecordSchema 保形，id = frontmatter name 回落目录名，
  // teamId = 请求 team 占位。XMON-109（spec 13 回摆）：写路径进 scope——
  // POST /api/skills 建、PUT teams/{id}/skills/{sid} 覆写式更新（frontmatter
  // 是唯一真值），双动作落 skill_audit 审计行；GitHub scan 面仍不出）————
  app.get('/api/skills', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    return c.json(
      scanLocalSkills(ctx.skillsDir).map((s) =>
        skillRecordSchema.parse({
          id: s.id,
          teamId,
          name: s.name,
          description: s.description,
        }),
      ),
    );
  });

  // POST /api/skills?teamId=（XMON-109）：body {name, description, files[]}；
  // actor = 请求 member。→ 201 record（id = body.name = 目录名 = frontmatter
  // name 三者同值；校验细节见 services/skills.ts createLocalSkill）。
  app.post('/api/skills', async (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    const body = parseWith(createSkillBodySchema, await jsonBody(c), 'body');
    const record = createLocalSkill(
      { db: ctx.db, skillsDir: ctx.skillsDir, teamId, actor: { type: 'member', id: ctx.user.id } },
      body,
    );
    return c.json(record, 201);
  });

  // PUT /api/teams/{id}/skills/{sid}（XMON-109）：覆写式更新——列出者覆写、
  // 未列者保留；改名须携带新 SKILL.md（frontmatter 是唯一真值）；未知 sid
  // = 404。→ 200 record（id = 更新后 frontmatter name）。
  app.put('/api/teams/:id/skills/:sid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createSkillBodySchema, await jsonBody(c), 'body');
    const record = updateLocalSkill(
      {
        db: ctx.db,
        skillsDir: ctx.skillsDir,
        teamId,
        actor: { type: 'member', id: ctx.user.id },
      },
      c.req.param('sid'),
      body,
    );
    return c.json(record);
  });

  app.get('/api/teams/:id/skills/:sid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const resolved = resolveLocalSkill(ctx.skillsDir, c.req.param('sid'));
    if (!resolved) throw notFound(`skill ${c.req.param('sid')}`);
    // 封套 [推断]：record + 文件名清单（内容经 /file 逐文件取，01 §6；
    // 清单 = 磁盘递归相对路径，spec 13 换源）。
    return c.json({
      ...skillRecordSchema.parse({
        id: resolved.skill.id,
        teamId,
        name: resolved.skill.name,
        description: resolved.skill.description,
      }),
      fileNames: listSkillFiles(resolved.dir),
    });
  });

  app.get('/api/teams/:id/skills/:sid/file', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const resolved = resolveLocalSkill(ctx.skillsDir, c.req.param('sid'));
    if (!resolved) throw notFound(`skill ${c.req.param('sid')}`);
    const fileName = c.req.query('fileName') ?? SKILL_ENTRY_FILE;
    const content = readSkillFile(resolved.dir, fileName); // 逃逸/缺位 = null
    if (content === null) throw notFound(`file ${fileName}`);
    return c.json({ fileName, content }); // 封套 [推断]；文本投影
  });

  // POST /api/teams/{id}/skills/import（#1170）：导入通道——body {localPath}
  // 或 {url} 二选一（本地目录 / GitHub 公共仓子目录）。收集与安全守卫在
  // services/skill-import.ts（SSRF 固定 host 面 / realpath 归一 / 只读复制
  // / 字节闸 / utf8 严格），落盘复用 createLocalSkill 全部既有校验 + 审计。
  // → 201 record（与 POST /api/skills 同形）。
  app.post('/api/teams/:id/skills/import', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(importSkillBodySchema, await jsonBody(c), 'body');
    const record = await importSkill(importOpts(teamId), body);
    return c.json(record, 201);
  });

  // POST /api/teams/{id}/skills/{sid}/refresh（#1170）：按登记来源重拉，技能
  // id 不变（来源 frontmatter name 漂移 = 409 拒绝），复用 updateLocalSkill
  // 覆写语义；无来源记录（手建技能）= 409 说明。→ 200 record。
  app.post('/api/teams/:id/skills/:sid/refresh', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const record = await refreshSkill(importOpts(teamId), c.req.param('sid'));
    return c.json(record);
  });

  // whats-new（词表内：形状保留、内容自选，02 §6.1 [设计]——记录 = whats_new
  // 表 body JSON 行）。
  app.get('/api/whats-new', (c) => {
    const rows = ctx.db.select().from(whatsNew).all();
    return c.json(rows.map((r) => ({ id: r.id, createdAt: r.createdAt, ...r.body })));
  });

  // —— 密钥三面（02 §8：API 面写只读掩码 + apiKey 存哈希；at-rest 经 SecretBox）。
  // provider 三面 = 词表内（GET/POST/PATCH，r3 §2/§8.2）+ DELETE（DELETE_FACE
  // 「可以替换或删除」r2 §6.5）；secret/apiKey 路径 = REST 同名 [推断]
  // （页与弹窗实测存在 r2 §6.3/§6.7/r3 §6，wire 未采；登记 test/wire.test.ts）。
  const keysvc = { db: ctx.db, box: ctx.secretBox };

  app.get('/api/teams/:id/providers', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    // 封套 [推断]：presets[] 字段实测在位（r3 §2），并列 providers 包络形未采。
    return c.json(getProvidersEnvelope(keysvc, teamId));
  });

  // model-sources 面（spec 11 数据契约，#356；#707 起 claude-code 段跟随
  // 执行机）：providers 页 runtime tabs 真值——pi = custom providers models[]
  // 投影；claude-code = 各执行机 daemon 上报的本机 settings.json 解析结果
  // （按机器聚合，未上报的机器缺席）。
  app.get('/api/teams/:id/model-sources', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(getModelSources(keysvc, teamId));
  });

  app.post('/api/teams/:id/providers', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createProviderBodySchema, await jsonBody(c), 'body');
    const record = createProvider(keysvc, { teamId, body, createdBy: ctx.user.id });
    return c.json(record, 201); // 封套 [推断]：全记录（安全超集，永不含 apiKey）
  });

  app.patch('/api/teams/:id/providers/:pid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(patchProviderBodySchema, await jsonBody(c), 'body');
    return c.json(updateProvider(keysvc, teamId, c.req.param('pid'), body));
  });

  app.delete('/api/teams/:id/providers/:pid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!deleteProvider(keysvc, teamId, c.req.param('pid'))) {
      throw notFound(`provider ${c.req.param('pid')}`);
    }
    return c.body(null, 204);
  });

  // —— OAuth 握手面（#231，[设计] 面：todos.dev 此面 wire 未采；词表登记 =
  // shared WEB_REST_ENDPOINTS，族表 = OAUTH_FAMILIES）。token 密封落
  // provider.apiKeyCipher（02 §8 只写不读）；callback 302 回 providers 页，
  // 结果经 ?oauth=connected|error 查询参传递——token 永不进 redirect。
  const oauthDeps = (): OAuthDeps => ({
    db: ctx.db,
    box: ctx.secretBox,
    states: ctx.oauthStates,
    fetch: ctx.oauthFetch ?? globalThis.fetch,
    client: ctx.oauthClient,
  });

  app.post('/api/teams/:id/providers/oauth/:preset/authorize', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    // returnOrigin = 浏览器 origin（vite proxy 下同源经 /api 转发，Origin 头
    // 原样透传）；裸 API 形态缺 Origin 时回退请求自身 origin。
    const origin = c.req.header('origin') ?? new URL(c.req.url).origin;
    try {
      const { authorizationUrl } = startOAuthAuthorize(oauthDeps(), {
        teamId,
        presetId: c.req.param('preset'),
        origin,
      });
      return c.json({ authorizationUrl });
    } catch (err) {
      if (err instanceof OAuthFlowError) {
        if (err.reason === 'unknown-family') throw new HttpError(404, err.message);
        if (err.reason === 'not-configured') throw new HttpError(400, err.message);
      }
      throw err;
    }
  });

  app.get('/api/oauth/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state') ?? '';
    // 落点按 state 族分支（#361），单点描述符：provider 族回 providers 页
    // （#231 原律）；github-connection 族回新建项目页（flag github=connection
    // = 该页着陆消费的 picker 打开/错误信号，provider 族着陆不带、两页互不
    // 串）。kind 不可判（bad-state 不在册形）→ 默认 providers 页；origin 缺
    // （同形）→ 相对 Location：浏览器同源解析，不引入请求方提供的任何
    // origin——「不信任外部 returnOrigin」纪律不变。
    const landingFor = (kind: OAuthStateKind | undefined) =>
      kind === 'github-connection'
        ? { path: '/app/project/new', flag: '&github=connection' }
        : { path: '/app/resources/providers', flag: '' };
    const landing = (
      origin: string | undefined,
      kind: OAuthStateKind | undefined,
      result: string,
    ) => {
      const target = landingFor(kind);
      return c.redirect(`${origin ?? ''}${target.path}?${result}${target.flag}`, 302);
    };
    // #243：state 缺/过期不再裸 400——统一 302 reason=state，与
    // denied/exchange 同律（web 着陆面给可重试路径）。
    const badStateLanding = (err: OAuthFlowError) =>
      landing(err.origin, err.kind, 'oauth=error&reason=state');
    // 用户在 provider 站拒绝（GitHub：?error=access_denied&state=…，无 code）。
    if (c.req.query('error') !== undefined || code === undefined || code === '') {
      try {
        const { origin, kind } = abortOAuthCallback(oauthDeps(), state);
        return landing(origin, kind, 'oauth=error&reason=denied');
      } catch (err) {
        if (err instanceof OAuthFlowError && err.reason === 'bad-state') {
          return badStateLanding(err);
        }
        throw err;
      }
    }
    try {
      const outcome = await completeOAuthCallback(oauthDeps(), {
        code,
        state,
        createdBy: ctx.user.id,
      });
      const result =
        outcome.kind === 'provider'
          ? `oauth=connected&provider=${outcome.presetId}`
          : 'oauth=connected';
      return landing(outcome.origin, outcome.kind, result);
    } catch (err) {
      if (err instanceof OAuthFlowError) {
        if (err.reason === 'exchange-failed' && err.origin !== undefined) {
          return landing(err.origin, err.kind, 'oauth=error&reason=exchange');
        }
        if (err.reason === 'bad-state') return badStateLanding(err);
      }
      throw err;
    }
  });

  // —— GitHub 连接认证面（spec 12 / #361 G2-T4，[设计] 面：todos.dev 此面
  // wire 未采，INFERRED_ROUTES 登记）。authorize = state 签发（github-
  // connection 族——callback 按 kind 分支落回新建项目页）；GET connection =
  // 认证状态读面（login/scope，token 位永不出现，02 §8）；DELETE = 断开
  // （删行幂等，DAO 单点 services/github-connection.ts）。
  app.post('/api/teams/:id/github/oauth/authorize', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    // returnOrigin 纪律同 provider 族 authorize（Origin 头随 state 绑定）。
    const origin = c.req.header('origin') ?? new URL(c.req.url).origin;
    try {
      const { authorizationUrl } = startGithubConnectionAuthorize(oauthDeps(), {
        teamId,
        origin,
      });
      return c.json({ authorizationUrl });
    } catch (err) {
      if (err instanceof OAuthFlowError && err.reason === 'not-configured') {
        throw new HttpError(400, err.message);
      }
      throw err;
    }
  });

  app.get('/api/teams/:id/github/connection', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(readGithubConnectionStatus({ db: ctx.db, box: ctx.secretBox }, teamId));
  });

  app.delete('/api/teams/:id/github/connection', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    deleteGithubConnection({ db: ctx.db, box: ctx.secretBox }, teamId);
    return c.body(null, 204);
  });

  /** GET /api/github/repos?q=（spec 12 / #359：新建项目 repo picker 数据面）。
   * GitHub `GET /user/repos` 代理——token 取自 github_connection（SecretBox
   * 密文解封仅在此出站边界，Authorization 头唯一消费位，never 进 URL/日志/
   * 响应）；未连接 = 404（web 面据此显示「认证 GitHub」入口，spec 12 story 2）。
   * q = full_name 大小写不敏感子串过滤 [设计]（上游无查询参数面，本地过滤）；
   * 限流两形经 lib/github.ts 错误映射直透（429/502）。封套单源 = shared
   * githubReposResponseSchema（spec 12 数据契约）。 */
  app.get('/api/github/repos', async (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    const token = openGithubToken({ db: ctx.db, box: ctx.secretBox }, teamId);
    if (token === null) throw notFound('github connection');
    const fetchImpl = ctx.githubFetch ?? fetch;
    const repos = await githubUserRepos(fetchImpl, token);
    const q = c.req.query('q')?.trim().toLowerCase() ?? '';
    const hits = q === '' ? repos : repos.filter((r) => r.fullName.toLowerCase().includes(q));
    return c.json(
      githubReposResponseSchema.parse({
        repos: hits.map((r) => ({
          id: r.id,
          owner: r.owner,
          name: r.name,
          full_name: r.fullName,
          private: r.isPrivate,
        })),
      }),
    );
  });

  app.get('/api/teams/:id/secrets', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listSecrets(keysvc, teamId)); // SecretRecord[]：value 永不出现（02 §8）
  });

  app.post('/api/teams/:id/secrets', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(setSecretBodySchema, await jsonBody(c), 'body');
    const record = createSecret(keysvc, {
      teamId,
      name: body.name,
      description: body.description ?? null,
      value: body.value,
    });
    return c.json(record, 201); // 封套 [推断]：全记录（值只写不读）
  });

  app.patch('/api/teams/:id/secrets/:sid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(patchSecretBodySchema, await jsonBody(c), 'body');
    return c.json(updateSecret(keysvc, teamId, c.req.param('sid'), body));
  });

  app.delete('/api/teams/:id/secrets/:sid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!deleteSecret(keysvc, teamId, c.req.param('sid'))) {
      throw notFound(`secret ${c.req.param('sid')}`);
    }
    return c.body(null, 204);
  });

  app.get('/api/teams/:id/api-keys', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    // 掩码行 [推断]（r3 §6 展示规则；行标识/掩码列 wire 字段未采）。
    return c.json(listApiKeys(svc, teamId));
  });

  app.post('/api/teams/:id/api-keys', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createApiKeyBodySchema, await jsonBody(c), 'body');
    const created = createApiKey(svc, {
      teamId,
      name: body.name ?? null,
      gitAccess: body.gitAccess,
      mcpAccess: body.mcpAccess,
      toolGrants: body.toolGrants,
    });
    // 创建响应含明文一次（02 §8/r3 §6；封套 [推断]；文案 canon =
    // shared API_KEY_ONE_TIME_COPY，web 面渲染）。
    return c.json(created, 201);
  });
}
