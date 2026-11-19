import {
  bindGithubConnectorBodySchema,
  capabilitiesResponseSchema,
  cloakLicenseBodySchema,
  composioConnectBodySchema,
  composioKeyBodySchema,
  createAntigravitySubscriptionSchema,
  createClaudeSubscriptionSchema,
  createDevinSubscriptionSchema,
  createMcpConnectorBodySchema,
  createProviderBodySchema,
  createScheduleBodySchema,
  createSkillBodySchema,
  githubReposResponseSchema,
  importSkillBodySchema,
  type MachineFolderGrants,
  type MachineRunningThread,
  machineStrain,
  PHASE_VALUES,
  patchMachineBodySchema,
  patchMcpConnectorBodySchema,
  patchProviderBodySchema,
  patchScheduleBodySchema,
  redactSecrets,
  renameAntigravitySubscriptionSchema,
  renameClaudeSubscriptionSchema,
  renameDevinSubscriptionSchema,
  SKILL_ENTRY_FILE,
  setSecretBodySchema,
  skillRecordSchema,
  startGithubConnectorDeviceBodySchema,
  startMcpConnectorOAuthBodySchema,
  THINKING_LEVELS,
  testProviderBodySchema,
} from '@cairn/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import type { Db } from './db/client.js';
import { build, machine, provider, routingRule, step, team, todo } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { githubAppUserRepos, githubUserRepos, isGithubAppUserToken } from './lib/github.js';
import { nowMs } from './lib/ids.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { newScheduleWebhookToken } from './lib/webhook-token.js';
import {
  createApiKeyBodySchema,
  githubAppOf,
  jsonBody,
  patchSecretBodySchema,
  requestOrigin,
  requireTeam,
  svcOf,
} from './routes-helpers.js';
import {
  antigravitySubscriptionUpstreamModels,
  createAntigravitySubscription,
  deleteAntigravitySubscription,
  disableAntigravitySubscription,
  enableAntigravitySubscription,
  listAntigravitySubscriptionSteps,
  listAntigravitySubscriptions,
  patchAntigravitySubscription,
  verifyAntigravitySubscriptionConnection,
} from './services/antigravity-subscriptions.js';
import { createApiKey, listApiKeys } from './services/api-keys.js';
import {
  listBrowserPasswordGrants,
  revokeBrowserPasswordGrant,
} from './services/browser-passwords.js';
import {
  createClaudeSubscription,
  deleteClaudeSubscription,
  disableClaudeSubscription,
  enableClaudeSubscription,
  listClaudeSubscriptions,
  renameClaudeSubscription,
  verifySubscriptionConnection,
} from './services/claude-subscriptions.js';
import { saveCloakLicense } from './services/cloak-license.js';
import { pollCodexDeviceLogin, startCodexDeviceLogin } from './services/codex-device-login.js';
import { deleteComposioKey, saveComposioKey } from './services/composio.js';
import {
  authorizeComposioApp,
  type ComposioConnectorDeps,
  connectComposioApp,
  listComposioApps,
  pollComposioApp,
  reconnectComposioApp,
  removeComposioApp,
  revokeComposioApp,
} from './services/composio-connectors.js';
import { stepIdOfGitKey } from './services/credentials.js';
import {
  createDevinSubscription,
  deleteDevinSubscription,
  devinSubscriptionUpstreamModels,
  disableDevinSubscription,
  enableDevinSubscription,
  listDevinSubscriptions,
  updateDevinSubscription,
  verifyDevinSubscriptionConnection,
} from './services/devin-subscriptions.js';
import { planDocumentDiff } from './services/documents.js';
import {
  deleteGithubConnection,
  hasGithubConnection,
  readGithubConnectionStatus,
  teamGithubToken,
} from './services/github-connection.js';
import {
  cancelGithubConnectionDevice,
  type GithubConnectionDeviceDeps,
  githubConnectionInstallUrl,
  pollGithubConnectionDevice,
  startGithubConnectionDevice,
} from './services/github-connection-device.js';
import { adoptGithubProfile } from './services/github-profile.js';
import { isOwner } from './services/instance-owner.js';
import { pendingComputerOutputRelease } from './services/machine-computer.js';
import { applyFolderPinOps } from './services/machine-folders.js';
import { revokeMachineToken } from './services/machine-revoke.js';
import {
  machineConcurrencyPatch,
  machineRunningCount,
  toMachineRecord,
} from './services/machines.js';
import {
  bindGithubConnector,
  cancelGithubConnectorDevice,
  githubConnectorAvailability,
  githubConnectorInstalled,
  githubConnectorTarget,
  pollGithubConnectorDevice,
  startGithubConnectorDevice,
} from './services/mcp-github-connector.js';
import {
  checkMcpConnector,
  connectorRow,
  createMcpConnector,
  deleteMcpConnector,
  githubAppOfDeps,
  listMcpConnectors,
  listMcpServers,
  type McpConnectorDeps,
  publicOAuthFetch,
  toConnectorRecord,
  updateMcpConnector,
} from './services/mcp-servers.js';
import { refreshAllRelayCatalogs } from './services/model-liveness.js';
import {
  abortOAuthCallback,
  completeOAuthCallback,
  type OAuthDeps,
  OAuthFlowError,
  type OAuthStateKind,
  startGithubConnectionAuthorize,
  startMcpConnectorAuthorize,
  startOAuthAuthorize,
} from './services/oauth.js';
import { listOwnComputerActivity } from './services/own-computer.js';
import {
  listUpstreamModels,
  ProviderTestLimiter,
  testProviderConnection,
} from './services/provider-test.js';
import {
  createProvider,
  deleteProvider,
  getModelSources,
  getProvidersEnvelope,
  updateProvider,
} from './services/providers.js';
import { seedClaudeCodeRules } from './services/routing-rules.js';
import { runScheduleNow } from './services/schedule-run.js';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  setScheduleEnabled,
} from './services/schedules.js';
import { search } from './services/search.js';
import {
  createSecret,
  deleteSecret,
  listSecrets,
  listSecretsWithEnvValues,
  updateSecret,
} from './services/secrets.js';
import {
  importSkill,
  listImportCandidates,
  refreshSkill,
  type SkillImportOpts,
} from './services/skill-import.js';
import {
  createLocalSkill,
  listSkillFiles,
  readSkillFile,
  resolveLocalSkill,
  scanLocalSkills,
  updateLocalSkill,
} from './services/skills.js';
import { queuedThreadsByMachine } from './services/step-queue.js';
import { pollXaiDeviceLogin, startXaiDeviceLogin } from './services/xai-device-login.js';

export function registerResourceRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  const isOwnerSession = (c: Context): boolean =>
    pairedDeviceIdOf(c) === null &&
    (ctx.authToken === null || c.get('ownerIdentity') !== undefined) &&
    isOwner(ctx.db, ctx.user.id);

  const requireOwnerSession = (c: Context): void => {
    if (!isOwnerSession(c)) {
      throw new HttpError(403, 'Only the instance owner can manage Claude subscription tokens');
    }
  };

  const importOpts = (teamId: string): SkillImportOpts => ({
    db: ctx.db,
    skillsDir: ctx.skillsDir,
    skillSourcesPath: ctx.skillSourcesPath,
    teamId,
    actor: { type: 'member', id: ctx.user.id },
    fetch: ctx.skillImportFetch ?? globalThis.fetch,
    ...(ctx.skillImportTimeoutMs !== undefined ? { timeoutMs: ctx.skillImportTimeoutMs } : {}),
  });

  app.get('/api/teams/:id/mcp-servers', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listMcpServers({ mcpConfigPath: ctx.mcpConfigPath, db: ctx.db }, teamId));
  });

  app.get('/api/documents/:id/diff', (c) => {
    const against = c.req.query('againstVersion');
    const diff = planDocumentDiff(
      ctx.db,
      c.req.param('id'),
      against !== undefined && against !== '' ? Number(against) : undefined,
    );
    return c.json(diff);
  });

  app.get('/api/schedules', (c) => {
    const teamId = c.req.query('team') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    return c.json(listSchedules(svc, teamId));
  });

  app.post('/api/schedules', async (c) => {
    const body = parseWith(createScheduleBodySchema, await jsonBody(c), 'body');
    const webhookToken = body.kind === 'webhook' ? newScheduleWebhookToken() : null;
    const record = createSchedule(
      svc,
      {
        ...body,
        teamId: ctx.team.id,
        createdBy: ctx.user.id,
      },
      webhookToken === null ? {} : { webhookToken: webhookToken.token },
    );
    if (webhookToken === null) return c.json(record, 201);
    return c.json(
      {
        ...record,
        webhookToken: webhookToken.token,
        webhookUrl: `${requestOrigin(c)}/api/webhook/schedule/${webhookToken.token}`,
      },
      201,
    );
  });

  app.patch('/api/schedules/:id', async (c) => {
    const id = c.req.param('id');
    const body = parseWith(patchScheduleBodySchema, await jsonBody(c), 'body');
    const record = setScheduleEnabled(svc, id, body, ctx.team.id);
    if (!record) throw notFound(`schedule ${id}`);
    return c.json(record);
  });

  app.delete('/api/schedules/:id', (c) => {
    const id = c.req.param('id');
    if (!deleteSchedule(svc, id, ctx.team.id)) throw notFound(`schedule ${id}`);
    return c.body(null, 204);
  });

  app.post('/api/schedules/:id/run', (c) =>
    c.json(runScheduleNow(svc, ctx.team.id, c.req.param('id'))),
  );

  app.get('/api/search', (c) =>
    c.json(search(svc, { teamId: ctx.team.id, q: c.req.query('q') ?? null })),
  );

  app.get('/api/teams/:id/machines', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const rows = ctx.db.select().from(machine).where(eq(machine.teamId, id)).all();
    const running = runningThreadsByMachine(ctx.db, id);
    const queued = queuedThreadsByMachine(ctx.db, id);
    return c.json(
      rows.map((r) => ({
        ...toMachineRecord(r, machineRunningCount(ctx.db, r.id)),
        running: running.get(r.id) ?? [],
        queued: queued.get(r.id) ?? [],
        strain: machineStrain(r.capabilities?.hardware),
      })),
    );
  });

  app.patch('/api/machines/:id', async (c) => {
    const id = c.req.param('id');
    const row = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!row) throw notFound(`machine ${id}`);
    requireTeam(ctx, row.teamId);
    const body = parseWith(patchMachineBodySchema, await jsonBody(c), 'body');
    if (body.browserOverride !== undefined || body.desktopOverride !== undefined) {
      if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
      if (
        (body.browserOverride === true && row.capabilities?.browser !== true) ||
        (body.desktopOverride === true && row.capabilities?.computer !== true)
      ) {
        throw new HttpError(409, 'machine does not report the requested capability');
      }
    }
    if (body.isDefault === true) {
      if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
      if (row.tokenHash === null) throw new HttpError(409, 'machine is not enrolled');
    }
    if (body.enabledRuntimes !== undefined) {
      throw new HttpError(
        409,
        'runtimes follow what the Runner detects; there is no runtime switch to change',
      );
    }
    let folderGrantsPatch: { folderGrants: MachineFolderGrants } | undefined;
    if (body.folderPins !== undefined) {
      if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
      folderGrantsPatch = { folderGrants: applyFolderPinOps(row.folderGrants, body.folderPins) };
    }
    const patch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.browserOverride !== undefined ? { browserOverride: body.browserOverride } : {}),
      ...(body.desktopOverride !== undefined ? { desktopOverride: body.desktopOverride } : {}),
      ...(body.maxConcurrent !== undefined ? machineConcurrencyPatch(row, body.maxConcurrent) : {}),
      ...(folderGrantsPatch !== undefined ? folderGrantsPatch : {}),
    };
    if (Object.keys(patch).length > 0) {
      ctx.db.update(machine).set(patch).where(eq(machine.id, id)).run();
    }
    if (body.isDefault === true) {
      ctx.db.update(team).set({ defaultMachineId: id }).where(eq(team.id, row.teamId)).run();
      ctx.machineHub.wake(row.teamId);
    }
    const updated = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!updated) throw notFound(`machine ${id}`);
    return c.json(toMachineRecord(updated, machineRunningCount(ctx.db, id)));
  });

  const ownedMachine = (c: Context) => {
    const id = c.req.param('id') ?? '';
    const row = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!row) throw notFound(`machine ${id}`);
    requireTeam(ctx, row.teamId);
    if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
    return row;
  };

  app.get('/api/machines/:id/own-computer/activity', (c) =>
    c.json({ activity: listOwnComputerActivity(ctx.db, ownedMachine(c)) }),
  );

  app.delete('/api/machines/:id', (c) => {
    const id = c.req.param('id');
    const row = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!row) throw notFound(`machine ${id}`);
    requireTeam(ctx, row.teamId);
    ctx.db
      .update(routingRule)
      .set({ machineId: null, updatedAt: nowMs() })
      .where(eq(routingRule.machineId, id))
      .run();
    ctx.db.update(team).set({ defaultMachineId: null }).where(eq(team.defaultMachineId, id)).run();
    const releasePendingOutput = pendingComputerOutputRelease(ctx.db, id);
    ctx.db.delete(machine).where(eq(machine.id, id)).run();
    releasePendingOutput();
    ctx.machineHub.revokeMachine(id);
    return c.body(null, 204);
  });

  app.post('/api/machines/:id/revoke', (c) => {
    const id = c.req.param('id');
    const row = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!row) throw notFound(`machine ${id}`);
    requireTeam(ctx, row.teamId);
    revokeMachineToken(ctx, id);
    return c.body(null, 204);
  });

  app.get('/api/capabilities', (c) => {
    return c.json(
      capabilitiesResponseSchema.parse({
        thinkingLevels: THINKING_LEVELS,
        githubOAuth: ctx.oauthClient !== null,
        githubDeviceInstallUrl: githubConnectionInstallUrl(
          githubAppOfDeps(ctx.mcpGithubApp === undefined ? {} : { githubApp: ctx.mcpGithubApp }),
        ),
      }),
    );
  });

  app.get('/api/teams/:id/models', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const rows = ctx.db.select().from(provider).where(eq(provider.teamId, id)).all();
    const models = rows.flatMap((r) =>
      r.models.map((m) => ({ ...m, providerId: r.providerId, providerLabel: r.label })),
    );
    return c.json(models);
  });

  app.get('/api/teams/:id/progress', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const rows = ctx.db
      .select({ phase: todo.phase })
      .from(todo)
      .where(and(eq(todo.teamId, id), isNull(todo.archivedAt)))
      .all();
    const byPhase: Record<string, number> = Object.fromEntries(PHASE_VALUES.map((p) => [p, 0]));
    for (const r of rows) byPhase[r.phase] = (byPhase[r.phase] ?? 0) + 1;
    return c.json({ todos: { total: rows.length, byPhase } });
  });

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

  app.get('/api/teams/:id/skills/import-candidates', (c) => {
    requireTeam(ctx, c.req.param('id'));
    return c.json(listImportCandidates(ctx.skillsDir));
  });

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
    const content = readSkillFile(resolved.dir, fileName);
    if (content === null) throw notFound(`file ${fileName}`);
    return c.json({ fileName, content });
  });

  app.post('/api/teams/:id/skills/import', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(importSkillBodySchema, await jsonBody(c), 'body');
    const record = await importSkill(importOpts(teamId), body);
    return c.json(record, 201);
  });

  app.post('/api/teams/:id/skills/:sid/refresh', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const record = await refreshSkill(importOpts(teamId), c.req.param('sid'));
    return c.json(record);
  });

  const keysvc = { db: ctx.db, box: ctx.secretBox };

  app.get('/api/teams/:id/claude-subscriptions', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listClaudeSubscriptions(keysvc, teamId));
  });

  app.post('/api/teams/:id/claude-subscriptions', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    const body = parseWith(createClaudeSubscriptionSchema, await jsonBody(c), 'body');
    const created = createClaudeSubscription(keysvc, teamId, body);
    if (created.enabled) seedClaudeCodeRules(ctx.db, teamId);
    return c.json(created, 201);
  });

  app.delete('/api/teams/:id/claude-subscriptions/:cid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    if (!deleteClaudeSubscription(keysvc, teamId, c.req.param('cid'))) {
      throw notFound('Claude subscription connection');
    }
    return c.body(null, 204);
  });

  app.patch('/api/teams/:id/claude-subscriptions/:cid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    const body = parseWith(renameClaudeSubscriptionSchema, await jsonBody(c), 'body');
    return c.json(renameClaudeSubscription(keysvc, teamId, c.req.param('cid'), body.label));
  });

  app.post('/api/teams/:id/claude-subscriptions/:cid/enable', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(await enableClaudeSubscription(keysvc, teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/claude-subscriptions/:cid/disable', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(disableClaudeSubscription(keysvc, teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/claude-subscriptions/:cid/verify', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    const subscriptionId = c.req.param('cid');
    const started = performance.now();
    const result = await verifySubscriptionConnection(keysvc, teamId, subscriptionId);
    ctx.logger?.info(
      {
        teamId,
        subscriptionId,
        ok: result.ok,
        reason: result.reason ?? null,
        durationMs: Math.round(performance.now() - started),
      },
      'Claude subscription verification completed',
    );
    return c.json(result);
  });

  app.get('/api/teams/:id/devin-subscriptions', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listDevinSubscriptions(keysvc, teamId));
  });

  app.post('/api/teams/:id/devin-subscriptions', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    const body = parseWith(createDevinSubscriptionSchema, await jsonBody(c), 'body');
    return c.json(createDevinSubscription(keysvc, teamId, body), 201);
  });

  app.delete('/api/teams/:id/devin-subscriptions/:cid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    if (!deleteDevinSubscription(keysvc, teamId, c.req.param('cid'))) {
      throw notFound('Devin subscription connection');
    }
    return c.body(null, 204);
  });

  app.patch('/api/teams/:id/devin-subscriptions/:cid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    const body = parseWith(renameDevinSubscriptionSchema, await jsonBody(c), 'body');
    return c.json(updateDevinSubscription(keysvc, teamId, c.req.param('cid'), body));
  });

  app.post('/api/teams/:id/devin-subscriptions/:cid/enable', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(await enableDevinSubscription(keysvc, teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/devin-subscriptions/:cid/disable', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(disableDevinSubscription(keysvc, teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/devin-subscriptions/:cid/verify', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(await verifyDevinSubscriptionConnection(keysvc, teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/devin-subscriptions/:cid/upstream-models', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(await devinSubscriptionUpstreamModels(keysvc, teamId, c.req.param('cid')));
  });

  app.get('/api/teams/:id/antigravity-subscriptions', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listAntigravitySubscriptions(keysvc, teamId));
  });

  app.post('/api/teams/:id/antigravity-subscriptions', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    const body = parseWith(createAntigravitySubscriptionSchema, await jsonBody(c), 'body');
    return c.json(createAntigravitySubscription(keysvc, teamId, body), 201);
  });

  app.delete('/api/teams/:id/antigravity-subscriptions/:cid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    if (!deleteAntigravitySubscription(keysvc, teamId, c.req.param('cid'))) {
      throw notFound('Antigravity subscription connection');
    }
    return c.body(null, 204);
  });

  app.patch('/api/teams/:id/antigravity-subscriptions/:cid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    const body = parseWith(renameAntigravitySubscriptionSchema, await jsonBody(c), 'body');
    return c.json(patchAntigravitySubscription(keysvc, teamId, c.req.param('cid'), body));
  });

  app.post('/api/teams/:id/antigravity-subscriptions/:cid/enable', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(await enableAntigravitySubscription(keysvc, teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/antigravity-subscriptions/:cid/disable', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(disableAntigravitySubscription(keysvc, teamId, c.req.param('cid')));
  });

  app.get('/api/teams/:id/antigravity-subscriptions/:cid/steps', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const limit = Math.min(Math.max(Math.trunc(Number(c.req.query('limit') ?? 20)) || 20, 1), 100);
    return c.json(listAntigravitySubscriptionSteps(keysvc, teamId, c.req.param('cid'), limit));
  });

  app.post('/api/teams/:id/antigravity-subscriptions/:cid/verify', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(
      await verifyAntigravitySubscriptionConnection(keysvc, teamId, c.req.param('cid')),
    );
  });

  app.post('/api/teams/:id/antigravity-subscriptions/:cid/upstream-models', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireOwnerSession(c);
    return c.json(await antigravitySubscriptionUpstreamModels(keysvc, teamId, c.req.param('cid')));
  });

  app.get('/api/teams/:id/providers', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json({
      ...getProvidersEnvelope(keysvc, teamId),
      canTestConnection: pairedDeviceIdOf(c) === null && isOwner(ctx.db, ctx.user.id),
    });
  });

  app.get('/api/teams/:id/model-sources', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    refreshAllRelayCatalogs(keysvc, teamId).catch(() => {});
    return c.json(getModelSources(keysvc, teamId));
  });

  app.post('/api/teams/:id/providers', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createProviderBodySchema, await jsonBody(c), 'body');
    const record = createProvider(keysvc, { teamId, body, createdBy: ctx.user.id });
    return c.json(record, 201);
  });

  app.patch('/api/teams/:id/providers/:pid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(patchProviderBodySchema, await jsonBody(c), 'body');
    return c.json(updateProvider(keysvc, teamId, c.req.param('pid'), body));
  });

  const providerTestLimiter = new ProviderTestLimiter();
  const providerTestDeps = () => ({
    ...keysvc,
    fetch: ctx.providerTestFetch ?? globalThis.fetch,
    tokenFetch: ctx.oauthFetch ?? globalThis.fetch,
    ...(ctx.providerTestTimeoutMs === undefined ? {} : { timeoutMs: ctx.providerTestTimeoutMs }),
  });
  app.post('/api/teams/:id/providers/:pid/test', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!isOwner(ctx.db, ctx.user.id)) {
      throw new HttpError(
        403,
        redactSecrets('Only the owner can test a provider connection.').value as string,
      );
    }
    const body = parseWith(testProviderBodySchema, (await jsonBody(c)) ?? {}, 'body');
    const id = c.req.param('pid');
    return c.json(
      await testProviderConnection(
        { ...providerTestDeps(), limiter: providerTestLimiter },
        { teamId, id, ...body },
      ),
    );
  });

  app.get('/api/teams/:id/providers/:pid/upstream-models', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (pairedDeviceIdOf(c) !== null || !isOwner(ctx.db, ctx.user.id)) {
      throw new HttpError(
        403,
        redactSecrets('Only the owner can list upstream models.').value as string,
      );
    }
    return c.json(await listUpstreamModels(providerTestDeps(), { teamId, id: c.req.param('pid') }));
  });

  app.delete('/api/teams/:id/providers/:pid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!deleteProvider(keysvc, teamId, c.req.param('pid'))) {
      throw notFound(`provider ${c.req.param('pid')}`);
    }
    return c.body(null, 204);
  });

  const mcpDeps = (): McpConnectorDeps => ({
    db: ctx.db,
    box: ctx.secretBox,
    mcpConfigPath: ctx.mcpConfigPath,
    fetch: ctx.mcpFetch ?? globalThis.fetch,
    oauthFetch: ctx.mcpFetch ?? publicOAuthFetch,
    oauthState: ctx.mcpOAuthState,
    githubFetch: ctx.githubFetch,
    oauthClient: ctx.oauthClient,
    ...(ctx.mcpGithubApp !== undefined ? { githubApp: ctx.mcpGithubApp } : {}),
  });

  const oauthDeps = (): OAuthDeps => ({
    db: ctx.db,
    box: ctx.secretBox,
    states: ctx.oauthStates,
    fetch: ctx.oauthFetch ?? globalThis.fetch,
    client: ctx.oauthClient,
    mcp: mcpDeps(),
  });

  const xaiDeviceDeps = () => ({
    db: ctx.db,
    box: ctx.secretBox,
    fetch: ctx.oauthFetch ?? globalThis.fetch,
    states: ctx.xaiDeviceStates,
  });

  app.post('/api/teams/:id/providers/oauth/xai/device', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const started = await startXaiDeviceLogin(xaiDeviceDeps(), {
      teamId,
      createdBy: ctx.user.id,
    });
    return c.json(started);
  });

  app.post('/api/teams/:id/providers/oauth/xai/device/poll', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = (await jsonBody(c)) as { state?: unknown };
    if (typeof body.state !== 'string' || body.state === '') {
      throw new HttpError(400, 'state required');
    }
    return c.json(await pollXaiDeviceLogin(xaiDeviceDeps(), { teamId, state: body.state }));
  });

  const codexDeviceDeps = () => ({
    db: ctx.db,
    box: ctx.secretBox,
    fetch: ctx.oauthFetch ?? globalThis.fetch,
    states: ctx.codexDeviceStates,
  });

  app.post('/api/teams/:id/providers/oauth/openai-codex/device', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const started = await startCodexDeviceLogin(codexDeviceDeps(), {
      teamId,
      createdBy: ctx.user.id,
    });
    return c.json(started);
  });

  app.post('/api/teams/:id/providers/oauth/openai-codex/device/poll', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = (await jsonBody(c)) as { state?: unknown };
    if (typeof body.state !== 'string' || body.state === '') {
      throw new HttpError(400, 'state required');
    }
    return c.json(await pollCodexDeviceLogin(codexDeviceDeps(), { teamId, state: body.state }));
  });

  app.post('/api/teams/:id/providers/oauth/:preset/authorize', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const origin = c.req.header('origin') ?? requestOrigin(c);
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
    const landingFor = (kind: OAuthStateKind | undefined) =>
      kind === 'github-connection'
        ? { path: '/app/project/new', flag: '&github=connection' }
        : kind === 'mcp-connector'
          ? { path: '/app/resources/mcp-servers', flag: '' }
          : { path: '/app/resources/providers', flag: '' };
    const landing = (
      origin: string | undefined,
      kind: OAuthStateKind | undefined,
      result: string,
    ) => {
      const target = landingFor(kind);
      return c.redirect(`${origin ?? ''}${target.path}?${result}${target.flag}`, 302);
    };
    const badStateLanding = (err: OAuthFlowError) =>
      landing(err.origin, err.kind, 'oauth=error&reason=state');
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
        iss: c.req.query('iss'),
        createdBy: ctx.user.id,
      });
      if (outcome.kind === 'github-connection') adoptGithubProfile(ctx, ctx.team.id);
      const result =
        outcome.kind === 'provider'
          ? `oauth=connected&provider=${outcome.presetId}`
          : outcome.kind === 'mcp-connector'
            ? `oauth=connected&connector=${outcome.connectorId}`
            : 'oauth=connected';
      return landing(outcome.origin, outcome.kind, result);
    } catch (err) {
      if (err instanceof OAuthFlowError) {
        if (err.reason === 'exchange-failed' && err.origin !== undefined) {
          return landing(err.origin, err.kind, 'oauth=error&reason=exchange');
        }
        if (err.reason === 'conflict' && err.origin !== undefined) {
          return landing(err.origin, err.kind, 'oauth=error&reason=conflict');
        }
        if (err.reason === 'bad-state') return badStateLanding(err);
      }
      throw err;
    }
  });

  app.post('/api/teams/:id/github/oauth/authorize', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const origin = c.req.header('origin') ?? requestOrigin(c);
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

  const connectionDeviceDeps = (): GithubConnectionDeviceDeps => ({
    db: ctx.db,
    box: ctx.secretBox,
    fetch: ctx.githubFetch ?? globalThis.fetch,
    app: githubAppOfDeps(ctx.mcpGithubApp === undefined ? {} : { githubApp: ctx.mcpGithubApp }),
    attempts: ctx.githubConnectionDeviceStates,
  });

  app.post('/api/teams/:id/github/connection/device', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(
      await startGithubConnectionDevice(connectionDeviceDeps(), { teamId, userId: ctx.user.id }),
    );
  });

  app.post('/api/teams/:id/github/connection/device/:attempt', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const result = await pollGithubConnectionDevice(connectionDeviceDeps(), {
      teamId,
      userId: ctx.user.id,
      attemptId: c.req.param('attempt'),
    });
    if (result.status === 'complete') adoptGithubProfile(ctx, teamId);
    return c.json(result);
  });

  app.delete('/api/teams/:id/github/connection/device/:attempt', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    cancelGithubConnectionDevice(connectionDeviceDeps(), {
      teamId,
      userId: ctx.user.id,
      attemptId: c.req.param('attempt'),
    });
    return c.body(null, 204);
  });

  app.get('/api/github/repos', async (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    const access = await teamGithubToken(
      {
        ...githubAppOf(ctx),
        db: ctx.db,
        box: ctx.secretBox,
        githubFetch: ctx.githubFetch,
        oauthClient: ctx.oauthClient,
      },
      teamId,
    );
    if (!('token' in access)) throw notFound('github connection');
    const fetchImpl = ctx.githubFetch ?? fetch;
    const repos = isGithubAppUserToken(access.token)
      ? await githubAppUserRepos(fetchImpl, access.token)
      : await githubUserRepos(fetchImpl, access.token);
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

  app.get('/api/teams/:id/mcp-connectors', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listMcpConnectors(mcpDeps(), teamId));
  });

  app.post('/api/teams/:id/mcp-connectors', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createMcpConnectorBodySchema, await jsonBody(c), 'body');
    const created = createMcpConnector(mcpDeps(), teamId, body);
    return c.json(await checkMcpConnector(mcpDeps(), teamId, created.id), 201);
  });

  app.patch('/api/teams/:id/mcp-connectors/:cid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(patchMcpConnectorBodySchema, await jsonBody(c), 'body');
    const { record, targetChanged } = updateMcpConnector(
      mcpDeps(),
      teamId,
      c.req.param('cid'),
      body,
    );
    return c.json(targetChanged ? await checkMcpConnector(mcpDeps(), teamId, record.id) : record);
  });

  const composioDeps = (): ComposioConnectorDeps => ({
    composio: {
      db: ctx.db,
      box: ctx.secretBox,
      fetch: ctx.composioFetch ?? ctx.mcpFetch ?? globalThis.fetch,
    },
    mcp: mcpDeps(),
  });

  const requireConnectorOwner = (c: Context): void => {
    if (!isOwnerSession(c)) {
      throw new HttpError(403, 'only the instance owner can manage connector apps');
    }
  };

  app.put('/api/teams/:id/mcp-connectors/composio/key', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireConnectorOwner(c);
    const body = parseWith(composioKeyBodySchema, (await jsonBody(c)) ?? {}, 'body');
    saveComposioKey(composioDeps().composio, teamId, body.key);
    return c.json({ configured: true });
  });

  app.delete('/api/teams/:id/mcp-connectors/composio/key', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireConnectorOwner(c);
    deleteComposioKey(composioDeps().composio, teamId);
    return c.body(null, 204);
  });

  app.get('/api/teams/:id/mcp-connectors/composio', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(await listComposioApps(composioDeps(), teamId));
  });

  app.post('/api/teams/:id/mcp-connectors/composio/toolkits', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireConnectorOwner(c);
    const body = parseWith(composioConnectBodySchema, (await jsonBody(c)) ?? {}, 'body');
    return c.json(await connectComposioApp(composioDeps(), teamId, body.slug), 201);
  });

  app.post('/api/teams/:id/mcp-connectors/composio/:cid/authorize', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireConnectorOwner(c);
    return c.json(await authorizeComposioApp(composioDeps(), teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/mcp-connectors/composio/:cid/poll', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireConnectorOwner(c);
    return c.json(await pollComposioApp(composioDeps(), teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/mcp-connectors/composio/:cid/reconnect', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireConnectorOwner(c);
    return c.json(await reconnectComposioApp(composioDeps(), teamId, c.req.param('cid')));
  });

  app.post('/api/teams/:id/mcp-connectors/composio/:cid/revoke', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    requireConnectorOwner(c);
    return c.json(await revokeComposioApp(composioDeps(), teamId, c.req.param('cid')));
  });

  app.delete('/api/teams/:id/mcp-connectors/:cid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = connectorRow(mcpDeps(), teamId, c.req.param('cid'));
    if (row.authKind === 'composio') {
      requireConnectorOwner(c);
      if (!(await removeComposioApp(composioDeps(), teamId, c.req.param('cid'))))
        throw notFound(`mcp connector ${c.req.param('cid')}`);
      return c.body(null, 204);
    }
    if (!deleteMcpConnector(mcpDeps(), teamId, c.req.param('cid')))
      throw notFound(`mcp connector ${c.req.param('cid')}`);
    return c.body(null, 204);
  });

  app.post('/api/teams/:id/mcp-connectors/oauth/start', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(startMcpConnectorOAuthBodySchema, await jsonBody(c), 'body');
    return c.json(
      await startMcpConnectorAuthorize(oauthDeps(), {
        teamId,
        origin: c.req.header('origin') ?? requestOrigin(c),
        body,
      }),
    );
  });

  app.get('/api/teams/:id/mcp-connectors/github', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(githubConnectorAvailability(mcpDeps(), teamId));
  });

  app.post('/api/teams/:id/mcp-connectors/github/bind', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(bindGithubConnectorBodySchema, (await jsonBody(c)) ?? {}, 'body');
    if (!hasGithubConnection(ctx.db, teamId)) throw new HttpError(409, 'connect GitHub first');
    const deps = mcpDeps();
    const target = githubConnectorTarget(deps, teamId, body.connectorId);
    const id = bindGithubConnector(deps, teamId, target);
    try {
      await checkMcpConnector(deps, teamId, id);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
    return c.json(toConnectorRecord(deps, connectorRow(deps, teamId, id)), 201);
  });

  app.post('/api/teams/:id/mcp-connectors/github/device', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(startGithubConnectorDeviceBodySchema, (await jsonBody(c)) ?? {}, 'body');
    return c.json(
      await startGithubConnectorDevice(mcpDeps(), connectionDeviceDeps(), {
        teamId,
        userId: ctx.user.id,
        connectorId: body.connectorId,
      }),
    );
  });

  app.post('/api/teams/:id/mcp-connectors/github/device/:attempt', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const result = await pollGithubConnectorDevice(mcpDeps(), connectionDeviceDeps(), {
      teamId,
      userId: ctx.user.id,
      attemptId: c.req.param('attempt'),
    });
    if (result.status === 'complete') adoptGithubProfile(ctx, teamId);
    return c.json(result);
  });

  app.delete('/api/teams/:id/mcp-connectors/github/device/:attempt', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    cancelGithubConnectorDevice(connectionDeviceDeps(), {
      teamId,
      userId: ctx.user.id,
      attemptId: c.req.param('attempt'),
    });
    return c.body(null, 204);
  });

  app.post('/api/teams/:id/mcp-connectors/:cid/github/installations', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json({
      installed: await githubConnectorInstalled(mcpDeps(), teamId, c.req.param('cid')),
    });
  });

  app.post('/api/teams/:id/mcp-connectors/:cid/check', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(await checkMcpConnector(mcpDeps(), teamId, c.req.param('cid')));
  });

  app.get('/api/teams/:id/secrets', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const ownerCaller =
      pairedDeviceIdOf(c) === null &&
      (ctx.authToken === null || c.get('ownerIdentity') !== undefined);
    c.header('Cache-Control', 'no-store');
    return c.json(
      ownerCaller ? listSecretsWithEnvValues(keysvc, teamId) : listSecrets(keysvc, teamId),
    );
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
      ...(body.username !== undefined ? { username: body.username } : {}),
      projectId: body.projectId ?? null,
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.delivery !== undefined ? { delivery: body.delivery } : {}),
      ...(body.http !== undefined ? { http: body.http } : {}),
    });
    return c.json(record, 201);
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

  app.get('/api/teams/:id/browser-password-grants', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
    c.header('Cache-Control', 'no-store');
    return c.json({ grants: listBrowserPasswordGrants(ctx.db, teamId) });
  });

  app.delete('/api/teams/:id/browser-password-grants/:grantId', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
    revokeBrowserPasswordGrant(ctx.db, teamId, c.req.param('grantId'));
    return c.body(null, 204);
  });

  app.put('/api/teams/:id/cloak-license', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!isOwnerSession(c))
      throw new HttpError(403, 'Only the instance owner can save the CloakBrowser license');
    const body = parseWith(cloakLicenseBodySchema, await jsonBody(c), 'body');
    c.header('Cache-Control', 'no-store');
    return c.json(saveCloakLicense(keysvc, teamId, body.value));
  });

  app.get('/api/teams/:id/api-keys', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listApiKeys(svc, teamId).filter((key) => stepIdOfGitKey(key.name) === null));
  });

  app.post('/api/teams/:id/api-keys', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createApiKeyBodySchema, await jsonBody(c), 'body');
    const created = createApiKey(svc, {
      teamId,
      name: body.name,
      gitAccess: body.gitAccess,
      mcpAccess: body.mcpAccess,
      machineAccess: body.machineAccess,
      toolGrants: body.toolGrants,
    });
    return c.json(created, 201);
  });
}

function runningThreadsByMachine(db: Db, teamId: string): Map<string, MachineRunningThread[]> {
  const rows = db
    .select({
      machineId: machine.id,
      threadId: todo.id,
      title: todo.title,
      projectId: todo.projectId,
      claimedAt: step.claimedAt,
      lastProgressAt: step.lastProgressAt,
      createdAt: step.createdAt,
    })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .innerJoin(machine, eq(step.machineId, machine.id))
    .where(
      and(
        eq(step.status, 'claimed'),
        ne(step.kind, 'chief'),
        eq(machine.teamId, teamId),
        eq(todo.teamId, teamId),
      ),
    )
    .all();
  const grouped = new Map<string, MachineRunningThread[]>();
  for (const row of rows) {
    const startedAt = row.claimedAt ?? row.createdAt;
    const lastProgressAt = row.lastProgressAt ?? startedAt;
    const threads = grouped.get(row.machineId) ?? [];
    const listed = threads.find((thread) => thread.threadId === row.threadId);
    if (listed === undefined) {
      threads.push({
        threadId: row.threadId,
        title: row.title,
        projectId: row.projectId,
        startedAt,
        lastProgressAt,
      });
      grouped.set(row.machineId, threads);
    } else {
      listed.startedAt = Math.min(listed.startedAt, startedAt);
      listed.lastProgressAt = Math.max(listed.lastProgressAt ?? 0, lastProgressAt);
    }
  }
  for (const threads of grouped.values()) threads.sort((a, b) => a.startedAt - b.startedAt);
  return grouped;
}
