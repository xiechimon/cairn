import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  BROWSER_AUTH_HEADER,
  type ClerkAuthConfigResponse,
  dailyUsageQuerySchema,
  isBrowserAuthExempt,
  patchRoutingRuleBodySchema,
  patchTeamBodySchema,
  patchUserBodySchema,
  patchWorkPolicyBodySchema,
  policyUseSchema,
  putTopModelsBodySchema,
  routeUseSchema,
  serverUpdateRequestBodySchema,
  streamConversationsBodySchema,
  type TeamMember,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { team, user } from './db/schema.js';
import { toTeamRecord } from './db/seed.js';
import { conditionalGet } from './lib/conditional-get.js';
import { HttpError, parseWith } from './lib/errors.js';
import { requestOrigin } from './lib/request-origin.js';
import { openSseStream } from './lib/sse-headers.js';
import {
  isOpenRemotePath,
  matchesAuthToken,
  pairedDeviceIdOf,
  sameOriginPageWrite,
} from './lib/token-auth.js';
import { githubAppOf, jsonBody, requireTeam, SESSION_COOKIE } from './routes-helpers.js';
import {
  BackupImportInvalidError,
  BackupInProgressError,
  BackupNotFoundError,
} from './services/backup-service.js';
import { readBackupHealth } from './services/backup-status.js';
import {
  AUTH_COOKIE,
  browserMarkHashOf,
  clearAuthCookie,
  forgetBrowserSignIn,
  issueBrowserSession,
  requestIsSecure,
  revokeAllExternalBrowserSessions,
  revokeBrowserSession,
  setAuthCookie,
} from './services/browser-session.js';
import { releaseParkedCoordinatorSteps } from './services/chief.js';
import { coordinatorRunsOnPi } from './services/coordinator-context.js';
import { readDeployStatus } from './services/deploy-status.js';
import { createSerialConnection } from './services/events.js';
import {
  openAutonomyPauses,
  pauseTeamGithubRepos,
  resumeAutonomyPauses,
} from './services/github-autonomy-brake.js';
import { isOwner } from './services/instance-owner.js';
import { getModelRouting } from './services/model-routing.js';
import { handleDeliveryFailed, setNotificationVapidKeys } from './services/notification-router.js';
import {
  listUnreadEntityIds,
  markNotificationRead,
  markNotificationUnread,
} from './services/notifications.js';
import { pairedDeviceIdOfToken } from './services/paired-devices.js';
import { routingRuleIssues } from './services/routing-rule-issues.js';
import {
  coordinatorProfile,
  listRoutingSettings,
  upsertRoutingRule,
  upsertWorkPolicy,
} from './services/routing-rules.js';
import { buildServerVersionResponse, requestHostUpdate } from './services/server-version.js';
import { filterKnownSkillIds } from './services/skills.js';
import { startTeamStreamSession, streamSessionsOf } from './services/team-stream-session.js';
import { conversationTeamId } from './services/tool-guards.js';
import { readTopModels, writeTopModels } from './services/top-models.js';
import { dailyUsage } from './services/usage-daily.js';

const deliveryFailedBodySchema = z.object({ deliveryId: z.string().min(1).max(128) }).strict();

const ACCESS_REFUSALS = {
  invalid: { status: 401, error: 'Unauthorized' },
  'not-allowed': { status: 403, error: 'this account is not allowed' },
  unavailable: { status: 503, error: 'Cloudflare Access keys are unavailable' },
} as const;

const CLERK_REFUSALS = {
  invalid: { status: 401, error: 'Unauthorized' },
  'not-allowed': { status: 403, error: 'this account is not allowed' },
  unavailable: { status: 503, error: 'Clerk keys are unavailable' },
} as const;

export function registerCoreRoutes(app: Hono, ctx: AppContext): void {
  const streamSessions = streamSessionsOf(ctx);
  app.get('/api/auth/session', (c) => c.body(null, 204));

  app.post('/api/auth/session', (c) => {
    c.header('cache-control', 'no-store');
    if (ctx.authToken === null) return c.body(null, 204);
    const match = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
    const provided = match?.[1] ?? null;
    if (provided === null) {
      return c.json({ error: 'access token required' }, 403);
    }
    if (matchesAuthToken(ctx.authToken, provided)) {
      const session = issueBrowserSession(ctx.db, 'owner', null, browserMarkHashOf(c));
      setAuthCookie(
        c,
        session.token,
        requestIsSecure(c, ctx.webOrigin, ctx.trustedProxies),
        session.expiresAt,
      );
      return c.body(null, 204);
    }
    const deviceId = pairedDeviceIdOfToken(ctx.db, provided);
    if (deviceId !== null) {
      const session = issueBrowserSession(ctx.db, 'device', deviceId, browserMarkHashOf(c));
      setAuthCookie(
        c,
        session.token,
        requestIsSecure(c, ctx.webOrigin, ctx.trustedProxies),
        session.expiresAt,
      );
      return c.body(null, 204);
    }
    return c.json({ error: 'access token required' }, 403);
  });

  app.use('/api/*', async (c, next) => {
    if (
      !getCookie(c, SESSION_COOKIE) &&
      !isOpenRemotePath(c.req.path) &&
      !isBrowserAuthExempt(c.req.path)
    ) {
      setCookie(c, SESSION_COOKIE, ctx.user.id, { httpOnly: true, path: '/' });
    }
    await next();
  });

  app.post('/api/auth/access', async (c) => {
    if (ctx.accessVerifier == null) return c.json({ error: 'Not found' }, 404);
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return c.json({ error: 'same-origin proof required' }, 403);
    }
    const verdict = await ctx.accessVerifier(c.req.header('cf-access-jwt-assertion'));
    if (verdict.kind !== 'owner') {
      const refusal = ACCESS_REFUSALS[verdict.kind];
      ctx.logger?.info({ outcome: verdict.kind, status: refusal.status }, 'access exchange');
      return c.json({ error: refusal.error }, refusal.status);
    }
    ctx.logger?.info({ outcome: verdict.kind, status: 200 }, 'access exchange');
    const session = issueBrowserSession(
      ctx.db,
      'external',
      null,
      browserMarkHashOf(c),
      undefined,
      verdict.expiresAt,
    );
    setAuthCookie(
      c,
      session.token,
      requestIsSecure(c, ctx.webOrigin, ctx.trustedProxies),
      session.expiresAt,
    );
    return c.json({ ok: true });
  });

  app.get('/api/auth/clerk/config', (c) => {
    c.header('cache-control', 'no-store');
    const body: ClerkAuthConfigResponse =
      ctx.clerkAuth == null
        ? { enabled: false, publishableKey: null, issuer: null }
        : {
            enabled: true,
            publishableKey: ctx.clerkAuth.publishableKey,
            issuer: ctx.clerkAuth.issuer,
          };
    return c.json(body);
  });

  app.post('/api/auth/clerk', async (c) => {
    c.header('cache-control', 'no-store');
    if (ctx.clerkAuth == null) return c.json({ error: 'Not found' }, 404);
    const site = c.req.header('sec-fetch-site');
    if (
      c.req.header(BROWSER_AUTH_HEADER) !== '1' ||
      (site !== undefined && site !== 'same-origin' && site !== 'none')
    ) {
      return c.json({ error: 'same-origin proof required' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && origin !== requestOrigin(c, ctx.webOrigin, ctx.trustedProxies)) {
      return c.json({ error: 'same-origin proof required' }, 403);
    }
    const match = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
    const verdict = await ctx.clerkAuth.verify(match?.[1]);
    if (verdict.kind !== 'owner') {
      const refusal = CLERK_REFUSALS[verdict.kind];
      ctx.logger?.info({ outcome: verdict.kind, status: refusal.status }, 'clerk auth exchange');
      return c.json({ error: refusal.error }, refusal.status);
    }
    ctx.logger?.info({ outcome: verdict.kind, status: 200 }, 'clerk auth exchange');
    const session = issueBrowserSession(ctx.db, 'external', null, browserMarkHashOf(c));
    setAuthCookie(
      c,
      session.token,
      requestIsSecure(c, ctx.webOrigin, ctx.trustedProxies),
      session.expiresAt,
    );
    return c.json({ ok: true });
  });

  app.post('/api/auth/signout', (c) => {
    c.header('cache-control', 'no-store');
    const site = c.req.header('sec-fetch-site');
    if (
      c.req.header(BROWSER_AUTH_HEADER) !== '1' ||
      (site !== undefined && site !== 'same-origin' && site !== 'none')
    ) {
      return c.json({ error: 'same-origin proof required' }, 403);
    }
    const token = getCookie(c, AUTH_COOKIE);
    if (token !== undefined && token !== '') revokeBrowserSession(ctx.db, token);
    forgetBrowserSignIn(ctx.db, browserMarkHashOf(c));
    if (c.req.query('all') === '1' && c.get('ownerIdentity') !== undefined) {
      revokeAllExternalBrowserSessions(ctx.db);
    }
    clearAuthCookie(c, requestIsSecure(c, ctx.webOrigin, ctx.trustedProxies));
    return c.body(null, 204);
  });

  app.post('/api/auth/stream-ticket', (c) => {
    const deviceId = pairedDeviceIdOf(c);
    const owner = c.get('ownerIdentity');
    if (ctx.authToken !== null && owner === undefined && deviceId === null) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const ticket = ctx.streamTickets.issue(
      deviceId !== null
        ? { kind: 'device', deviceId }
        : owner !== undefined
          ? { kind: owner.via === 'access' ? 'external' : 'owner', deviceId: null }
          : { kind: 'owner', deviceId: null },
    );
    c.header('cache-control', 'no-store');
    return c.json({ ...ticket, transport: 'websocket' });
  });

  app.get('/api/user/me', (c) => c.json(ctx.user));

  app.patch('/api/user/me', async (c) => {
    const body = parseWith(patchUserBodySchema, await jsonBody(c), 'body');
    if (body.displayName !== undefined) {
      ctx.db
        .update(user)
        .set({ displayName: body.displayName, displayNameEdited: true })
        .where(eq(user.id, ctx.user.id))
        .run();
      ctx.user.displayName = body.displayName;
    }
    return c.json(ctx.user);
  });

  app.get('/api/server/backup', async (c) => {
    if (ctx.backupService !== undefined) {
      return c.json(await ctx.backupService.health());
    }
    return c.json(readBackupHealth(ctx.backupStatusPath));
  });

  app.post('/api/server/backup/run', async (c) => {
    if (ctx.backupService === undefined) {
      throw new HttpError(503, 'Built-in backup is not enabled on this server.');
    }
    if (
      getCookie(c, AUTH_COOKIE) !== undefined &&
      !sameOriginPageWrite(c, ctx.webOrigin, ctx.trustedProxies)
    ) {
      return c.body(null, 403);
    }
    try {
      const snapshot = await ctx.backupService.runBackup('manual');
      const health = await ctx.backupService.health();
      return c.json({ snapshot, health });
    } catch (error) {
      if (error instanceof BackupInProgressError) {
        throw new HttpError(409, error.message);
      }
      ctx.logger?.warn({ err: error }, 'manual backup failed');
      throw new HttpError(500, 'Backup failed.');
    }
  });

  app.post('/api/server/backup/export', async (c) => {
    if (ctx.backupService === undefined) {
      throw new HttpError(503, 'Built-in backup is not enabled on this server.');
    }
    if (
      getCookie(c, AUTH_COOKIE) !== undefined &&
      !sameOriginPageWrite(c, ctx.webOrigin, ctx.trustedProxies)
    ) {
      return c.body(null, 403);
    }
    try {
      const exported = await ctx.backupService.exportArchive();
      return new Response(new Uint8Array(exported.buffer), {
        status: 200,
        headers: {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${exported.filename}"`,
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      if (error instanceof BackupInProgressError) {
        throw new HttpError(409, error.message);
      }
      ctx.logger?.warn({ err: error }, 'backup export failed');
      throw new HttpError(500, 'Backup export failed.');
    }
  });

  app.post('/api/server/backup/:id/restore', async (c) => {
    if (ctx.backupService === undefined) {
      throw new HttpError(503, 'Built-in backup is not enabled on this server.');
    }
    if (
      getCookie(c, AUTH_COOKIE) !== undefined &&
      !sameOriginPageWrite(c, ctx.webOrigin, ctx.trustedProxies)
    ) {
      return c.body(null, 403);
    }
    const id = c.req.param('id');
    try {
      const result = await ctx.backupService.prepareRestore(id);
      return c.json(result);
    } catch (error) {
      if (error instanceof BackupNotFoundError) {
        throw new HttpError(404, error.message);
      }
      if (error instanceof BackupInProgressError) {
        throw new HttpError(409, error.message);
      }
      ctx.logger?.warn({ err: error, snapshotId: id }, 'backup restore failed');
      throw new HttpError(500, 'Backup restore failed.');
    }
  });

  app.post('/api/server/backup/import', async (c) => {
    if (ctx.backupService === undefined) {
      throw new HttpError(503, 'Built-in backup is not enabled on this server.');
    }
    if (
      getCookie(c, AUTH_COOKIE) !== undefined &&
      !sameOriginPageWrite(c, ctx.webOrigin, ctx.trustedProxies)
    ) {
      return c.body(null, 403);
    }
    let source: Buffer | Readable;
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      const form = await c.req.formData().catch(() => null);
      const file = form?.get('file');
      if (file === null || file === undefined || typeof file === 'string') {
        throw new HttpError(400, 'Missing backup archive file.');
      }
      source = Readable.fromWeb(file.stream() as unknown as WebReadableStream<Uint8Array>);
    } else if (c.req.raw.body !== null) {
      source = Readable.fromWeb(c.req.raw.body as unknown as WebReadableStream<Uint8Array>);
    } else {
      source = Buffer.alloc(0);
    }
    const keepHostRaw = c.req.query('keepHost');
    const pauseRaw = c.req.query('pauseExternalConnectors');
    const keepHost = keepHostRaw !== '0' && keepHostRaw !== 'false';
    const pauseExternalConnectors = pauseRaw !== '0' && pauseRaw !== 'false';
    try {
      const result = await ctx.backupService.prepareImport(source, {
        keepHost,
        pauseExternalConnectors,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof BackupImportInvalidError) {
        throw new HttpError(400, error.message);
      }
      if (error instanceof BackupInProgressError) {
        throw new HttpError(409, error.message);
      }
      ctx.logger?.warn({ err: error }, 'backup import failed');
      throw new HttpError(500, 'Backup import failed.');
    }
  });

  app.get('/api/server/deploy', (c) => c.json(readDeployStatus(ctx.deployRecordPath)));
  app.get('/api/server/version', (c) => {
    c.header('cache-control', 'no-store');
    const schemaVersion = c.req.query('schema') === '2' ? 2 : 1;
    return c.json(
      buildServerVersionResponse({
        db: ctx.db,
        homeDir: ctx.homeDir,
        deployRecordPath: ctx.deployRecordPath,
        now: ctx.hostUpdate?.now?.(),
        schemaVersion,
        latestRelease: ctx.releaseWatcher?.latestRelease() ?? null,
      }),
    );
  });
  app.post('/api/server/update', async (c) => {
    c.header('cache-control', 'no-store');
    const raw = await jsonBody(c);
    const body = parseWith(serverUpdateRequestBodySchema, raw ?? {}, 'body');
    const result = await requestHostUpdate({
      homeDir: ctx.homeDir,
      targetVersion: body.targetVersion,
      force: body.force,
      hostUpdate: ctx.hostUpdate,
    });
    return c.json(result, result.accepted ? 202 : 200);
  });

  app.get('/api/teams', (c) => {
    const row = ctx.db.select().from(team).where(eq(team.id, ctx.team.id)).get();
    return c.json(row === undefined ? [] : [toTeamRecord(row, openAutonomyPauses(ctx.db, row.id))]);
  });

  app.get('/api/teams/:id/model-routing', conditionalGet(), (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    return c.json(getModelRouting(ctx.db, id));
  });

  app.get('/api/teams/:id/routing-settings', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    return c.json({
      ...listRoutingSettings(ctx.db, id, coordinatorRunsOnPi()),
      ruleIssues: routingRuleIssues(ctx.db, id),
    });
  });

  app.get('/api/teams/:id/usage/daily', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const { days, tz } = parseWith(dailyUsageQuerySchema, c.req.query(), 'query');
    return c.json(dailyUsage(ctx.db, id, { days, tz, now: Date.now() }));
  });

  app.get('/api/teams/:id/top-models', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    return c.json(readTopModels(ctx.db, id, ctx.logger));
  });

  app.put('/api/teams/:id/top-models', async (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const ownerPage =
      (ctx.authToken === null || c.get('ownerIdentity') !== undefined) &&
      isOwner(ctx.db, ctx.user.id) &&
      sameOriginPageWrite(c, ctx.webOrigin, ctx.trustedProxies);
    if (!ownerPage) {
      throw new HttpError(
        403,
        'only the owner can change the frequently used models — ask the owner to change the list in Settings > Model',
      );
    }
    const body = parseWith(putTopModelsBodySchema, await jsonBody(c), 'body');
    const current = readTopModels(ctx.db, id);
    if (body.updatedAt !== undefined && body.updatedAt !== current.updatedAt) {
      throw new HttpError(409, '常用模型已在别处改动，这次保存没有生效。刷新页面后再改一次。');
    }
    const written = writeTopModels(ctx.db, id, body.models);
    ctx.hub.publish(id, () => ({ type: 'reconcile', teamId: id }));
    return c.json(written);
  });

  app.patch('/api/teams/:id/routing-rules/:use', async (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const use = parseWith(routeUseSchema, c.req.param('use'), 'use');
    const body = parseWith(patchRoutingRuleBodySchema, await jsonBody(c), 'body');
    const beforeCoordinator = use === 'coordinator' ? coordinatorProfile(ctx.db, id) : null;
    const saved = upsertRoutingRule(ctx.db, id, use, body);
    if (use === 'coordinator') {
      const afterCoordinator = coordinatorProfile(ctx.db, id);
      const nextProvider = afterCoordinator?.provider ?? saved.provider;
      const nextModelId = afterCoordinator?.modelId ?? saved.modelId;
      if (
        beforeCoordinator?.provider !== nextProvider ||
        beforeCoordinator?.modelId !== nextModelId
      ) {
        releaseParkedCoordinatorSteps(
          {
            db: ctx.db,
            hub: ctx.hub,
            convHub: ctx.convHub,
            machineHub: ctx.machineHub,
          },
          id,
        );
      }
    }
    return c.json(saved);
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
    const row = ctx.db.select().from(team).where(eq(team.id, id)).get();
    return c.json({
      ...ctx.team,
      ...(row === undefined ? {} : toTeamRecord(row, openAutonomyPauses(ctx.db, id))),
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

  setNotificationVapidKeys(ctx.db, ctx.vapidKeys ?? null);
  const notificationDeps = {
    db: ctx.db,
    hub: ctx.hub,
    user: ctx.user,
    vapidKeys: ctx.vapidKeys,
  };

  app.get('/api/teams/:id/notifications', conditionalGet(), (c) => {
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

  app.post('/api/teams/:id/notifications/:entityId/delivery-failed', async (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const body = parseWith(deliveryFailedBodySchema, await jsonBody(c), 'body');
    const result = handleDeliveryFailed(
      notificationDeps,
      id,
      c.req.param('entityId'),
      body.deliveryId,
    );
    if (!result.handled) return c.json({ error: 'stale delivery' }, 409);
    return c.json({ ok: true });
  });

  app.get('/api/teams/:id/stream', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return openSseStream(c, async (stream) => {
      const conn = createSerialConnection<string>(
        (data, seq) => stream.writeSSE({ data, id: String(seq) }),
        { onOverflow: () => stream.abort() },
      );
      const held = new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
      const stop = startTeamStreamSession(ctx, {
        teamId,
        deviceId: pairedDeviceIdOf(c),
        conn,
        abort: () => stream.abort(),
      });
      await held.finally(stop);
    });
  });

  app.put('/api/streams/:connectionId/conversations', async (c) => {
    const body = parseWith(streamConversationsBodySchema, await jsonBody(c), 'body');
    const session = streamSessions.get(c.req.param('connectionId'));
    if (session === undefined || session.deviceId !== pairedDeviceIdOf(c)) {
      return c.json({ error: 'unknown stream connection' }, 404);
    }
    requireTeam(ctx, session.teamId);
    if (body.revision === undefined && session.revision !== undefined) {
      return c.json({ error: 'revision required for this stream connection' }, 409);
    }
    const conversationIds = body.conversationIds.filter((id) => {
      const owner = conversationTeamId(ctx.db, id);
      return owner === undefined || owner === session.teamId;
    });
    const revision = streamSessions.setConversations(
      session,
      conversationIds,
      ctx.convHub,
      body.revision,
    );
    if (session.closed) return c.json({ error: 'unknown stream connection' }, 404);
    return revision === undefined ? c.body(null, 204) : c.json({ revision });
  });
}
