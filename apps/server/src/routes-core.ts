import {
  patchRoutingRuleBodySchema,
  patchTeamBodySchema,
  patchUserBodySchema,
  patchWorkPolicyBodySchema,
  policyUseSchema,
  routeUseSchema,
  type TeamMember,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from './context.js';
import { team, user } from './db/schema.js';
import { toTeamRecord } from './db/seed.js';
import { parseWith } from './lib/errors.js';
import { loopbackOwnerOriginOf } from './lib/loopback-owner.js';
import { isOpenRemotePath, pairedDeviceIdOf } from './lib/token-auth.js';
import { githubAppOf, jsonBody, requireTeam, SESSION_COOKIE } from './routes-helpers.js';
import { readBackupHealth } from './services/backup-status.js';
import {
  AUTH_COOKIE,
  issueBrowserSession,
  issueStreamTicket,
  requestIsSecure,
  resolveBrowserSession,
  setAuthCookie,
} from './services/browser-session.js';
import { readDeployStatus } from './services/deploy-status.js';
import { createSerialConnection } from './services/events.js';
import { readFirstPrReportPrompt, setFirstPrReportPrompt } from './services/first-pr-report.js';
import {
  openAutonomyPauses,
  pauseTeamGithubRepos,
  resumeAutonomyPauses,
} from './services/github-autonomy-brake.js';
import { getModelRouting } from './services/model-routing.js';
import {
  listUnreadEntityIds,
  markNotificationRead,
  markNotificationUnread,
} from './services/notifications.js';
import { deviceStreams, pairedDeviceExists } from './services/paired-devices.js';
import {
  listRoutingSettings,
  upsertRoutingRule,
  upsertWorkPolicy,
} from './services/routing-rules.js';
import { filterKnownSkillIds } from './services/skills.js';

export function registerCoreRoutes(app: Hono, ctx: AppContext): void {
  app.use('/api/*', async (c, next) => {
    if (!getCookie(c, SESSION_COOKIE) && !isOpenRemotePath(c.req.path)) {
      setCookie(c, SESSION_COOKIE, ctx.user.id, { httpOnly: true, path: '/' });
    }
    await next();
  });

  app.post('/api/auth/bootstrap', (c) => {
    if (ctx.loopbackOwner == null || loopbackOwnerOriginOf(c, ctx.loopbackOwner) === null) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return c.json({ error: 'same-origin proof required' }, 403);
    }
    const existing = resolveBrowserSession(ctx.db, getCookie(c, AUTH_COOKIE) ?? '');
    if (existing?.kind === 'owner') return c.json({ ok: true });
    const session = issueBrowserSession(ctx.db, 'owner');
    setAuthCookie(c, session.token, requestIsSecure(c));
    return c.json({ ok: true });
  });

  app.post('/api/auth/stream-ticket', (c) => {
    const deviceId = pairedDeviceIdOf(c);
    const owner = c.get('ownerIdentity');
    if (owner === undefined && deviceId === null) return c.json({ error: 'Unauthorized' }, 401);
    const ticket = issueStreamTicket(
      owner !== undefined ? { kind: 'owner', deviceId: null } : { kind: 'device', deviceId },
    );
    c.header('cache-control', 'no-store');
    return c.json(ticket);
  });

  app.get('/api/auth/session', (c) => c.json(ctx.user));
  app.get('/api/user/me', (c) => c.json(ctx.user));

  app.patch('/api/user/me', async (c) => {
    const body = parseWith(patchUserBodySchema, await jsonBody(c), 'body');
    if (body.displayName !== undefined) {
      ctx.db
        .update(user)
        .set({ displayName: body.displayName })
        .where(eq(user.id, ctx.user.id))
        .run();
      ctx.user.displayName = body.displayName;
    }
    return c.json(ctx.user);
  });

  app.get('/api/server/backup', (c) => c.json(readBackupHealth(ctx.backupStatusPath)));
  app.get('/api/server/deploy', (c) => c.json(readDeployStatus(ctx.deployRecordPath)));

  app.get('/api/teams', (c) => {
    const row = ctx.db.select().from(team).where(eq(team.id, ctx.team.id)).get();
    return c.json(
      row === undefined
        ? []
        : [
            {
              ...toTeamRecord(row, openAutonomyPauses(ctx.db, row.id)),
              firstPrReportPrompt: readFirstPrReportPrompt(ctx.db, row.id),
            },
          ],
    );
  });

  app.get('/api/teams/:id/model-routing', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    return c.json(getModelRouting(ctx.db, id));
  });

  app.get('/api/teams/:id/routing-settings', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    return c.json(listRoutingSettings(ctx.db, id));
  });

  app.patch('/api/teams/:id/routing-rules/:use', async (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const use = parseWith(routeUseSchema, c.req.param('use'), 'use');
    const body = parseWith(patchRoutingRuleBodySchema, await jsonBody(c), 'body');
    return c.json(upsertRoutingRule(ctx.db, id, use, body));
  });

  app.patch('/api/teams/:id/work-policies/:use', async (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const use = parseWith(policyUseSchema, c.req.param('use'), 'use');
    const body = parseWith(patchWorkPolicyBodySchema, await jsonBody(c), 'body');
    const known: typeof body = { ...body };
    if (body.skillsAllowlist != null) {
      known.skillsAllowlist = filterKnownSkillIds(ctx.skillsDir, body.skillsAllowlist);
    }
    if (body.defaultSkill != null) {
      known.defaultSkill = filterKnownSkillIds(ctx.skillsDir, [body.defaultSkill])[0] ?? null;
    }
    return c.json(upsertWorkPolicy(ctx.db, id, use, known));
  });

  app.patch('/api/teams/:id', async (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const body = parseWith(patchTeamBodySchema, await jsonBody(c), 'body');
    if (body.claudeUsage !== undefined) {
      ctx.db.update(team).set({ claudeUsage: body.claudeUsage }).where(eq(team.id, id)).run();
    }
    if (body.coAuthorTrailer !== undefined) {
      ctx.db
        .update(team)
        .set({ coAuthorTrailer: body.coAuthorTrailer })
        .where(eq(team.id, id))
        .run();
    }
    if (body.requestInstructorReview !== undefined) {
      ctx.db
        .update(team)
        .set({ requestInstructorReview: body.requestInstructorReview })
        .where(eq(team.id, id))
        .run();
    }
    if (body.autonomyPaused === false) resumeAutonomyPauses(ctx.db, id);
    if (body.autonomyPaused === true) {
      await pauseTeamGithubRepos(
        {
          ...githubAppOf(ctx),
          db: ctx.db,
          box: ctx.secretBox,
          githubFetch: ctx.githubFetch,
          oauthClient: ctx.oauthClient,
        },
        id,
      );
    }
    if (body.maxAutonomousMergesPerDay !== undefined) {
      ctx.db
        .update(team)
        .set({ maxAutonomousMergesPerDay: body.maxAutonomousMergesPerDay })
        .where(eq(team.id, id))
        .run();
    }
    const prompt = setFirstPrReportPrompt(ctx.db, id, body.firstPrReportPrompt ?? {});
    const row = ctx.db.select().from(team).where(eq(team.id, id)).get();
    return c.json({
      ...ctx.team,
      ...(row === undefined ? {} : toTeamRecord(row, openAutonomyPauses(ctx.db, id))),
      firstPrReportPrompt: prompt,
    });
  });

  app.get('/api/teams/:id/members', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const rows: TeamMember[] = [
      {
        id: `member-${ctx.user.id}`,
        teamId: id,
        actorId: ctx.user.id,
        memberType: 'user',
        actor: ctx.user,
      },
    ];
    return c.json(rows);
  });

  const notificationDeps = { db: ctx.db, hub: ctx.hub, user: ctx.user };

  app.get('/api/teams/:id/notifications', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    return c.json({ unreadThreadIds: listUnreadEntityIds(notificationDeps, id) });
  });

  app.post('/api/teams/:id/notifications/:entityId/read', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    return c.json(markNotificationRead(notificationDeps, id, c.req.param('entityId')));
  });

  app.post('/api/teams/:id/notifications/:entityId/unread', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    return c.json(markNotificationUnread(notificationDeps, id, c.req.param('entityId')));
  });

  app.get('/api/teams/:id/stream', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return streamSSE(c, async (stream) => {
      const conn = createSerialConnection((payload) =>
        stream.writeSSE({ data: JSON.stringify(payload) }),
      );
      const unsubscribe = ctx.hub.subscribe(teamId, conn, ctx.user.id);
      const deviceId = pairedDeviceIdOf(c);
      const timer = setInterval(() => {
        if (deviceId !== null && !pairedDeviceExists(ctx.db, deviceId)) {
          stream.abort();
          return;
        }
        void conn.send({ type: 'ping', seq: conn.nextSeq() });
      }, ctx.pingIntervalMs);
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const unbindDevice = deviceStreams.bind(deviceId, () => stream.abort());
      stream.onAbort(() => {
        clearInterval(timer);
        unsubscribe();
        unbindDevice();
        release();
      });
      await conn.send({ type: 'ping', seq: conn.nextSeq() });
      await held;
    });
  });
}
