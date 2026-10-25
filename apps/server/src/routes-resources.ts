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
} from '@cairn/shared';
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
import {
  machineConcurrencyPatch,
  machineRunningCount,
  toMachineRecord,
} from './services/machines.js';
import { listMcpServers } from './services/mcp-servers.js';
import { mergedCatalogModels, refreshAllRelayCatalogs } from './services/model-liveness.js';
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
    return c.json(listMcpServers({ mcpConfigPath: ctx.mcpConfigPath }, teamId));
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

  app.get('/api/search', (c) =>
    c.json(search(svc, { teamId: ctx.team.id, q: c.req.query('q') ?? null })),
  );

  app.get('/api/teams/:id/machines', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    const rows = ctx.db.select().from(machine).where(eq(machine.teamId, id)).all();
    return c.json(rows.map((r) => toMachineRecord(r, machineRunningCount(ctx.db, r.id))));
  });

  app.patch('/api/machines/:id', async (c) => {
    const id = c.req.param('id');
    const row = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!row) throw notFound(`machine ${id}`);
    requireTeam(ctx, row.teamId);
    const body = parseWith(patchMachineBodySchema, await jsonBody(c), 'body');
    const patch = {
      ...(body.enabledRuntimes !== undefined ? { enabledRuntimes: body.enabledRuntimes } : {}),
      ...(body.shellEnabled !== undefined ? { shellEnabled: body.shellEnabled } : {}),
      ...(body.maxConcurrent !== undefined ? machineConcurrencyPatch(row, body.maxConcurrent) : {}),
    };
    if (Object.keys(patch).length > 0) {
      ctx.db.update(machine).set(patch).where(eq(machine.id, id)).run();
    }
    const updated = ctx.db.select().from(machine).where(eq(machine.id, id)).get();
    if (!updated) throw notFound(`machine ${id}`);
    return c.json(toMachineRecord(updated, machineRunningCount(ctx.db, id)));
  });

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
      const reject = homeMachineRejectReason(dst, a, mergedCatalogModels());
      if (reject !== null) {
        rejected.push({ agentId: a.id, reason: reject });
        continue;
      }
      ctx.db.update(agent).set({ machineId: dst.id }).where(eq(agent.id, a.id)).run();
      moved.push(a.id);
    }
    return c.json({ moved, rejected });
  });

  app.get('/api/capabilities', (c) => {
    return c.json(capabilitiesResponseSchema.parse({ thinkingLevels: THINKING_LEVELS }));
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
    const rows = ctx.db.select({ phase: todo.phase }).from(todo).where(eq(todo.teamId, id)).all();
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

  app.get('/api/whats-new', (c) => {
    const rows = ctx.db.select().from(whatsNew).all();
    return c.json(rows.map((r) => ({ id: r.id, createdAt: r.createdAt, ...r.body })));
  });

  const keysvc = { db: ctx.db, box: ctx.secretBox };

  app.get('/api/teams/:id/providers', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(getProvidersEnvelope(keysvc, teamId));
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

  app.delete('/api/teams/:id/providers/:pid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!deleteProvider(keysvc, teamId, c.req.param('pid'))) {
      throw notFound(`provider ${c.req.param('pid')}`);
    }
    return c.body(null, 204);
  });

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

  app.post('/api/teams/:id/github/oauth/authorize', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
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
    return c.json(listSecrets(keysvc, teamId));
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

  app.get('/api/teams/:id/api-keys', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
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
    return c.json(created, 201);
  });
}
