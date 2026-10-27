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

  app.post('/api/analytics/first-touch', () => new Response(null, { status: 204 }));
  app.post('/_mp/api/track', () => new Response(null, { status: 204 }));

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
        oauthClient: ctx.oauthClient,
        ...(ctx.convHub !== undefined ? { convHub: ctx.convHub } : {}),
        ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
      },
      c.req.raw,
    ),
  );
}
