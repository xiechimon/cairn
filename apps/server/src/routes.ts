// M2 核心 REST 面 + SSE team stream + repo 托管双形态 git 面——词表单源 =
// shared WEB_REST_ENDPOINTS（02 §6.1 canonical；路由对拍测试 = test/wire.test.ts）。
// 未观测响应封套按 [推断] 投影（04 §3 不判负口径），逐处标注。
// 覆盖面 = M2a 核心 CRUD + team stream + repo 双形态（02 §3/A4：托管 bare
// `git http-backend` + GitHub 接入记录面 + tree/file/branches 文件浏览）+
// schedule CRUD（02 §9.2，M2b）+ 密钥三面（provider/secret/apiKey，02 §8）+
// 搜索（02 §6.3，M2c）；machine/chief 面归 M3/M4。
// #1125 拆域：registerRoutes 瘦成编排——各资源域住 routes-<domain>.ts
// （routes-machine.ts 先例），共享件住 routes-helpers.ts；认证 cookie 中间件
// 住 core 且必须首个注册（Hono 的 use() 只盖其后注册的路由），编排顺序
// 不可调换。本文件自留：analytics 埋点空实现 + /api/mcp 协议面。

import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { registerAgentRoutes } from './routes-agents.js';
import { registerBuildRoutes } from './routes-builds.js';
import { registerChiefRoutes } from './routes-chief.js';
import { registerCoreRoutes } from './routes-core.js';
import { registerGitHostingRoutes } from './routes-git-hosting.js';
import { registerProjectRoutes } from './routes-projects.js';
import { registerResourceRoutes } from './routes-resources.js';
import { registerTodoRoutes } from './routes-todos.js';
import { registerUploadRoutes } from './routes-uploads.js';
import { registerWebhookRoutes } from './routes-webhook.js';
import { handleMcpRequest } from './services/mcp-face.js';

export function registerRoutes(app: Hono, ctx: AppContext): void {
  registerCoreRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerTodoRoutes(app, ctx);
  registerBuildRoutes(app, ctx);
  registerUploadRoutes(app, ctx);
  registerChiefRoutes(app, ctx);
  registerAgentRoutes(app, ctx);
  registerResourceRoutes(app, ctx);
  registerGitHostingRoutes(app, ctx);
  registerWebhookRoutes(app, ctx);

  // —— 埋点空实现（词表内「形状保留、可空实现」，02 §6.1：analytics/first-touch
  // + PostHog 风格 batch track；复刻无埋点后端，204 收下即弃）——————————
  app.post('/api/analytics/first-touch', () => new Response(null, { status: 204 }));
  app.post('/_mp/api/track', () => new Response(null, { status: 204 }));

  // —— MCP server 面（02 §7.2，M4b）：/api/mcp 路径保形；Bearer <apiKey> +
  // key 级 24 工具白名单；stateless streamable HTTP（services/mcp-face.ts =
  // server 侧唯一 sdk 薄桥位，00/D4）。app.all = 协议面动词族（POST JSON-RPC；
  // GET/DELETE stateless 405），wire 词表对拍按 ALL 豁免（git 面同族）。
  app.all('/api/mcp', (c) =>
    handleMcpRequest(
      {
        db: ctx.db,
        hub: ctx.hub,
        machineHub: ctx.machineHub,
        box: ctx.secretBox,
        user: ctx.user,
        reposDir: ctx.reposDir,
        attachmentsDir: ctx.attachmentsDir,
        mcpConfigPath: ctx.mcpConfigPath,
        skillsDir: ctx.skillsDir,
        ...(ctx.convHub !== undefined ? { convHub: ctx.convHub } : {}),
        ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
      },
      c.req.raw,
    ),
  );
}
