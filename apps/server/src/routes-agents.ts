import {
  AGENT_TOOL_DEFAULTS,
  agentMachineFitResponseSchema,
  agentTaskSchema,
  capabilityMissingLabels,
  createAgentBodySchema,
  filterAgentTools,
  IN_PROGRESS_PHASES,
  patchAgentBodySchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { agent, machine, todo } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { newRecordId } from './lib/ids.js';
import {
  agentRecordOf,
  jsonBody,
  requireAgentRow,
  requireTeam,
  toMemoryRecord,
} from './routes-helpers.js';
import { deleteAgent } from './services/agents.js';
import {
  declaredMcpGaps,
  homeMachineRejectReason,
  missingCapabilityItems,
  runtimeGatePasses,
} from './services/dispatch-eligibility.js';
import { deleteMemoryEntry, listMemoryEntries } from './services/memory.js';
import { mergedCatalogModels } from './services/model-liveness.js';
import { filterKnownSkillIds } from './services/skills.js';

export function registerAgentRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/teams/:id/agents/:aid/memories', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const agentId = c.req.param('aid');
    const rows = listMemoryEntries(
      ctx.db,
      { agentId, teamId },
      c.req.query('includeInvalid') === 'true',
    );
    return c.json(rows.map(toMemoryRecord));
  });

  app.delete('/api/teams/:id/agents/:aid/memories/:mid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const removed = deleteMemoryEntry(ctx.db, {
      memoryId: c.req.param('mid'),
      agentId: c.req.param('aid'),
      teamId,
    });
    if (removed === 0) throw notFound(`memory ${c.req.param('mid')}`);
    return c.body(null, 204);
  });

  app.post('/api/teams/:id/agents', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createAgentBodySchema, await jsonBody(c), 'body');
    const machineRow = ctx.db
      .select()
      .from(machine)
      .where(and(eq(machine.id, body.machineId), eq(machine.teamId, teamId)))
      .get();
    if (!machineRow) throw notFound(`machine ${body.machineId}`);
    const createReject = homeMachineRejectReason(
      machineRow,
      {
        provider: body.provider ?? null,
        modelId: body.modelId ?? null,
      },
      mergedCatalogModels(),
    );
    if (createReject) throw new HttpError(400, createReject);
    const id = newRecordId();
    ctx.db
      .insert(agent)
      .values({
        id,
        teamId,
        displayName: body.displayName,
        description: body.description ?? null,
        status: 'active',
        avatarUrl: null,
        provider: body.provider ?? null,
        modelId: body.modelId ?? null,
        thinkingLevel: body.thinkingLevel ?? null,
        tools: filterAgentTools(body.tools ?? [...AGENT_TOOL_DEFAULTS]),
        secrets: body.secrets ?? [],
        defaultSkill:
          body.defaultSkill != null
            ? (filterKnownSkillIds(ctx.skillsDir, [body.defaultSkill])[0] ?? null)
            : null,
        skillsAllowlist:
          body.skillsAllowlist == null
            ? null
            : filterKnownSkillIds(ctx.skillsDir, body.skillsAllowlist),
        mcpServers: body.mcpServers ?? [],
        maxConcurrentTasks: body.maxConcurrentTasks ?? null,
        machineId: body.machineId,
        persona: body.persona ?? null,
        requiredCapabilities: body.requiredCapabilities ?? null,
        fallbackModels: body.fallbackModels ?? null,
      })
      .run();
    return c.json({ id }, 201);
  });

  app.get('/api/teams/:id/agents/:aid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = requireAgentRow(ctx, teamId, c.req.param('aid'));
    return c.json(agentRecordOf(row));
  });

  app.patch('/api/teams/:id/agents/:aid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = requireAgentRow(ctx, teamId, c.req.param('aid'));
    const body = parseWith(patchAgentBodySchema, await jsonBody(c), 'body');
    const sets: Partial<typeof row> = {};
    if (body.defaultSkill !== undefined) {
      sets.defaultSkill =
        body.defaultSkill == null
          ? null
          : (filterKnownSkillIds(ctx.skillsDir, [body.defaultSkill])[0] ?? null);
    }
    if (body.skillsAllowlist !== undefined) {
      sets.skillsAllowlist =
        body.skillsAllowlist == null
          ? null
          : filterKnownSkillIds(ctx.skillsDir, body.skillsAllowlist);
    }
    if (body.tools !== undefined) {
      sets.tools = filterAgentTools(body.tools);
    }
    if (body.machineId !== undefined) {
      const target = ctx.db
        .select()
        .from(machine)
        .where(and(eq(machine.id, body.machineId), eq(machine.teamId, teamId)))
        .get();
      if (!target) throw notFound(`machine ${body.machineId}`);
      const reject = homeMachineRejectReason(
        target,
        {
          provider: body.provider !== undefined ? body.provider : row.provider,
          modelId: body.modelId !== undefined ? body.modelId : row.modelId,
        },
        mergedCatalogModels(),
      );
      if (reject) throw new HttpError(400, reject);
      sets.machineId = body.machineId;
    } else if ((body.provider !== undefined || body.modelId !== undefined) && row.machineId) {
      const home = ctx.db
        .select()
        .from(machine)
        .where(and(eq(machine.id, row.machineId), eq(machine.teamId, teamId)))
        .get();
      if (home) {
        const reject = homeMachineRejectReason(
          home,
          {
            provider: body.provider !== undefined ? body.provider : row.provider,
            modelId: body.modelId !== undefined ? body.modelId : row.modelId,
          },
          mergedCatalogModels(),
        );
        if (reject) throw new HttpError(400, reject);
      }
    }
    for (const key of [
      'displayName',
      'description',
      'provider',
      'modelId',
      'thinkingLevel',
      'secrets',
      'mcpServers',
      'persona',
      'maxConcurrentTasks',
      'requiredCapabilities',
      'fallbackModels',
    ] as const) {
      if (body[key] !== undefined) {
        sets[key] = (body[key] === null ? null : body[key]) as never;
      }
    }
    if (Object.keys(sets).length > 0) {
      ctx.db.update(agent).set(sets).where(eq(agent.id, row.id)).run();
    }
    const updated = requireAgentRow(ctx, teamId, row.id);
    return c.json(agentRecordOf(updated));
  });

  app.delete('/api/teams/:id/agents/:aid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const agentId = c.req.param('aid');
    if (!deleteAgent({ db: ctx.db }, teamId, agentId)) throw notFound(`agent ${agentId}`);
    return c.body(null, 204);
  });

  app.get('/api/teams/:id/agents/:aid/machine-fit', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = requireAgentRow(ctx, teamId, c.req.param('aid'));
    const machines = ctx.db
      .select()
      .from(machine)
      .where(eq(machine.teamId, teamId))
      .all()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const rows = machines.map((m) => {
      const runtimeOk = runtimeGatePasses(m, row.provider);
      const noSnapshot = m.capabilities === null && m.claudeCodeReport === null;
      const missing = noSnapshot
        ? null
        : capabilityMissingLabels(missingCapabilityItems(m, row.requiredCapabilities));
      return {
        machineId: m.id,
        name: m.name,
        online: m.online,
        runtimeOk,
        missing,
        mcpGaps: declaredMcpGaps(m, row),
        canRun: runtimeOk && (missing === null || missing.length === 0),
      };
    });
    return c.json(agentMachineFitResponseSchema.parse({ machines: rows }));
  });

  app.get('/api/teams/:id/agents/:aid/tasks', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const agentId = c.req.param('aid');
    const rows = ctx.db.select().from(todo).where(eq(todo.teamId, teamId)).all();
    const inFlight = rows.filter(
      (r) =>
        (r.assignment?.plan?.agentId === agentId || r.assignment?.build?.agentId === agentId) &&
        (IN_PROGRESS_PHASES as readonly string[]).includes(r.phase) &&
        r.latestBuildId !== null,
    );
    return c.json(
      inFlight.map((r) =>
        agentTaskSchema.parse({
          kind: 'build',
          state: r.phase === 'queued' ? 'waiting' : null,
          buildId: r.latestBuildId,
          todo: { id: r.id, seqNum: r.seqNum, title: r.title, phase: r.phase },
        }),
      ),
    );
  });
}
