import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { registerBuildRoutes } from './routes-builds.js';
import { registerChiefRoutes } from './routes-chief.js';
import { registerComputerScreenRoutes } from './routes-computer-screen.js';
import { registerComputerRoutes } from './routes-computers.js';
import { registerCoreRoutes } from './routes-core.js';
import { registerDeployRoutes } from './routes-deploy.js';
import { registerDesignRoutes } from './routes-design.js';
import { registerDraftRoutes } from './routes-drafts.js';
import { registerEngineScreenRoutes } from './routes-engine-screen.js';
import { registerGitHostingRoutes } from './routes-git-hosting.js';
import { registerGithubWebhookRoutes } from './routes-github-webhook.js';
import { githubAppOf } from './routes-helpers.js';
import { registerImRoutes } from './routes-im.js';
import { registerMailRoutes } from './routes-mail.js';
import { registerMemoryRoutes } from './routes-memories.js';
import { registerProjectRoutes } from './routes-projects.js';
import { registerPushRoutes } from './routes-push.js';
import { registerResourceRoutes } from './routes-resources.js';
import { registerScheduleWebhookRoutes } from './routes-schedule-webhook.js';
import { registerTodoRoutes } from './routes-todos.js';
import { registerUploadRoutes } from './routes-uploads.js';
import { handleMcpRequest } from './services/mcp-face.js';

export function registerRoutes(app: Hono, ctx: AppContext): void {
  registerCoreRoutes(app, ctx);
  registerDeployRoutes(app, ctx);
  registerComputerRoutes(app, ctx);
  registerComputerScreenRoutes(app, ctx);
  registerEngineScreenRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerTodoRoutes(app, ctx);
  registerBuildRoutes(app, ctx);
  registerUploadRoutes(app, ctx);
  registerDesignRoutes(app, ctx);
  registerDraftRoutes(app, ctx);
  registerChiefRoutes(app, ctx);
  registerMemoryRoutes(app, ctx);
  registerResourceRoutes(app, ctx);
  registerGitHostingRoutes(app, ctx);
  registerGithubWebhookRoutes(app, ctx);
  registerPushRoutes(app, ctx);
  registerImRoutes(app, ctx);
  registerMailRoutes(app, ctx);
  registerScheduleWebhookRoutes(app, ctx);

  app.all('/api/mcp', (c) =>
    handleMcpRequest(
      {
        ...githubAppOf(ctx),
        db: ctx.db,
        hub: ctx.hub,
        machineHub: ctx.machineHub,
        box: ctx.secretBox,
        user: ctx.user,
        vapidKeys: ctx.vapidKeys,
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
