import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build,
  chief,
  chiefThread,
  chiefTurnUsage,
  project as projectTable,
  provider as providerTable,
  routingRule,
  step,
  stepRoute,
  stepUsage,
  team as teamTable,
  teamTopModels,
  todo as todoTable,
  tokenUsage,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { newRecordId } from '../src/lib/ids.js';
import { createProvider, openProviderKey, updateProvider } from '../src/services/providers.js';
import { writeTopModels } from '../src/services/top-models.js';
import { bootServer, postProject, req, seedRoute, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

function world(): { s: TestServer; deps: { db: TestServer['db']; box: TestServer['secretBox'] } } {
  const s = bootServer();
  servers.push(s);
  return { s, deps: { db: s.db, box: s.secretBox } };
}

function addProvider(s: TestServer, providerId: string): string {
  return createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      body: {
        providerId,
        label: providerId,
        baseUrl: 'http://127.0.0.1:8798/v1',
        api: 'openai-completions',
        apiKey: `${providerId}-key`,
        models: [{ id: 'glm', name: 'glm' }],
      },
      createdBy: s.user.id,
    },
  ).id;
}

function insertOtherTeam(s: TestServer): string {
  const otherTeam = newRecordId();
  s.db
    .insert(teamTable)
    .values({ ...s.db.select().from(teamTable).get()!, id: otherTeam, name: 'other-team' })
    .run();
  return otherTeam;
}

function seedBuildScope(s: TestServer, projectId: string): { buildId: string; stepId: string } {
  const todoId = newRecordId();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'rename probe',
      phaseAt: 1,
      seqNum: 1,
    })
    .run();
  const buildId = newRecordId();
  s.db
    .insert(build)
    .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
  const stepId = newRecordId();
  s.db
    .insert(step)
    .values({ id: stepId, buildId, kind: 'build', status: 'done', createdAt: 1 })
    .run();
  return { buildId, stepId };
}

function seedThreadScope(s: TestServer): { threadId: string; stepId: string } {
  const chiefId = newRecordId();
  s.db
    .insert(chief)
    .values({ id: chiefId, userId: s.user.id, teamId: s.team.id, createdAt: 1 })
    .run();
  const threadId = `chief-${newRecordId()}`;
  s.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      title: 'rename thread',
      createdAt: 1,
      updatedAt: 1,
      sessionId: 'sess-1',
      sessionOpenedAt: 1,
    })
    .run();
  const stepId = newRecordId();
  s.db
    .insert(step)
    .values({ id: stepId, buildId: threadId, kind: 'chief', status: 'done', createdAt: 1 })
    .run();
  return { threadId, stepId };
}

function providerRow(s: TestServer, providerId: string) {
  return s.db
    .select()
    .from(providerTable)
    .where(and(eq(providerTable.teamId, s.team.id), eq(providerTable.providerId, providerId)))
    .get();
}

describe('provider PATCH rename rewrites every stored reference', () => {
  test('routing_rule provider and fallbackModels move to the new id', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    seedRoute(s, 'session', {
      provider: 'relay-old',
      modelId: 'glm',
      fallbackModels: [
        { provider: 'relay-old', modelId: 'glm-fb' },
        { provider: 'other-provider', modelId: 'keep' },
      ],
    });
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-new' });
    const rule = s.db.select().from(routingRule).get()!;
    expect(rule.provider).toBe('relay-new');
    expect(rule.fallbackModels).toEqual([
      { provider: 'relay-new', modelId: 'glm-fb' },
      { provider: 'other-provider', modelId: 'keep' },
    ]);
  });

  test('project modelOverrides move to the new id', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    const projectId = await postProject(s.app, 'rename-proj');
    s.db
      .update(projectTable)
      .set({
        modelOverrides: {
          coordinator: { provider: 'relay-old', modelId: 'glm', thinkingLevel: null },
          session: { provider: 'relay-old', modelId: 'glm-2', thinkingLevel: 'high' },
        },
      })
      .where(eq(projectTable.id, projectId))
      .run();
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-new' });
    expect(s.db.select().from(projectTable).get()?.modelOverrides).toEqual({
      coordinator: { provider: 'relay-new', modelId: 'glm', thinkingLevel: null },
      session: { provider: 'relay-new', modelId: 'glm-2', thinkingLevel: 'high' },
    });
  });

  test('step_route, step fallback and quotaBlock move to the new id', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    const projectId = await postProject(s.app, 'rename-proj');
    const { stepId } = seedBuildScope(s, projectId);
    s.db
      .update(step)
      .set({
        fallback: {
          model: { provider: 'relay-old', modelId: 'glm' },
          tried: ['relay-old/glm', 'other-provider/m', 'relay-old-x/sub'],
          zeroUsageRetried: false,
        },
        quotaBlock: {
          kind: 'quota',
          providerId: 'relay-old',
          label: null,
          reason: 'quota',
          retryAfterMs: null,
          firstSeenAt: 1,
          lastAt: 1,
          attempts: 1,
          probeAt: 1,
        },
      })
      .where(eq(step.id, stepId))
      .run();
    s.db
      .insert(stepRoute)
      .values({
        stepId,
        teamId: s.team.id,
        kind: 'build',
        difficulty: 'standard',
        provider: 'relay-old',
        modelId: 'glm',
        reason: 'test',
        rejected: [],
        decidedAt: 1,
      })
      .run();
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-new' });
    const stored = s.db.select().from(step).where(eq(step.id, stepId)).get()!;
    expect(stored.fallback?.model).toEqual({ provider: 'relay-new', modelId: 'glm' });
    expect(stored.fallback?.tried).toEqual([
      'relay-new/glm',
      'other-provider/m',
      'relay-old-x/sub',
    ]);
    expect(stored.quotaBlock?.providerId).toBe('relay-new');
    expect(s.db.select().from(stepRoute).get()?.provider).toBe('relay-new');
  });

  test('token_usage, step_usage and chief_turn_usage model keys move, chief threads scoped', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    const projectId = await postProject(s.app, 'rename-proj');
    const { buildId, stepId } = seedBuildScope(s, projectId);
    const { threadId, stepId: chiefStepId } = seedThreadScope(s);
    s.db.insert(tokenUsage).values({ buildId, model: 'relay-old/glm', input: 5, output: 3 }).run();
    s.db.insert(tokenUsage).values({ buildId: threadId, model: 'relay-old/glm-2', input: 7 }).run();
    s.db
      .insert(stepUsage)
      .values({
        stepId,
        model: 'relay-old/glm',
        teamId: s.team.id,
        buildId,
        kind: 'build',
        input: 5,
        createdAt: 1,
      })
      .run();
    s.db
      .insert(chiefTurnUsage)
      .values({
        stepId: chiefStepId,
        threadId,
        model: 'relay-old/glm',
        input: 9,
        createdAt: 1,
      })
      .run();
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-new' });
    const tokens = s.db
      .select()
      .from(tokenUsage)
      .all()
      .map((r) => r.model);
    expect(tokens.sort()).toEqual(['relay-new/glm', 'relay-new/glm-2']);
    expect(s.db.select().from(stepUsage).get()?.model).toBe('relay-new/glm');
    expect(s.db.select().from(chiefTurnUsage).get()?.model).toBe('relay-new/glm');
  });

  test('a usage row that already exists under the new key merges instead of violating the pk', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    const projectId = await postProject(s.app, 'rename-proj');
    const { buildId } = seedBuildScope(s, projectId);
    s.db
      .insert(tokenUsage)
      .values({
        buildId,
        model: 'relay-old/glm',
        input: 5,
        output: 3,
        cacheRead: 1,
        cacheWrite: 2,
        costInput: 1,
        costOutput: 2,
        costCacheRead: 3,
        costCacheWrite: 4,
        costTotal: 10,
      })
      .run();
    s.db
      .insert(tokenUsage)
      .values({
        buildId,
        model: 'relay-new/glm',
        input: 7,
        output: 11,
        costInput: 5,
        costOutput: 6,
        costCacheRead: 7,
        costCacheWrite: 8,
        costTotal: 26,
      })
      .run();
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-new' });
    const rows = s.db.select().from(tokenUsage).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      model: 'relay-new/glm',
      input: 12,
      output: 14,
      cacheRead: 1,
      cacheWrite: 2,
      costInput: 6,
      costOutput: 8,
      costCacheRead: 10,
      costCacheWrite: 12,
      costTotal: 36,
    });
  });

  test('team_top_models entries move to the new id', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    writeTopModels(s.db, s.team.id, [
      { provider: 'relay-old', modelId: 'glm', thinkingLevel: null },
      { provider: 'other-provider', modelId: 'keep', thinkingLevel: 'low' },
    ]);
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-new' });
    const stored = JSON.parse(s.db.select().from(teamTopModels).get()!.models) as {
      provider: string;
      modelId: string;
    }[];
    expect(stored).toEqual([
      { provider: 'relay-new', modelId: 'glm', thinkingLevel: null },
      { provider: 'other-provider', modelId: 'keep', thinkingLevel: 'low' },
    ]);
  });

  test('the key and lookup follow the new id; the old id is gone', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-new' });
    expect(providerRow(s, 'relay-old')).toBeUndefined();
    expect(providerRow(s, 'relay-new')?.id).toBe(pid);
    expect(openProviderKey(deps, s.team.id, 'relay-old')).toBeNull();
    expect(openProviderKey(deps, s.team.id, 'relay-new')?.apiKey).toBe('relay-old-key');
  });

  test('renames do not touch other teams or providers with a shared prefix', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay');
    addProvider(s, 'relay-long');
    const otherTeam = insertOtherTeam(s);
    s.db
      .insert(routingRule)
      .values({
        id: newRecordId(),
        teamId: otherTeam,
        use: 'session',
        provider: 'relay',
        modelId: 'glm',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const projectId = await postProject(s.app, 'rename-proj');
    const { buildId } = seedBuildScope(s, projectId);
    s.db.insert(tokenUsage).values({ buildId, model: 'relay-long/m', input: 1 }).run();
    s.db.insert(tokenUsage).values({ buildId, model: 'relay/glm', input: 2 }).run();
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-new' });
    expect(
      s.db.select().from(routingRule).where(eq(routingRule.teamId, otherTeam)).get()?.provider,
    ).toBe('relay');
    expect(
      s.db
        .select()
        .from(tokenUsage)
        .all()
        .map((r) => r.model)
        .sort(),
    ).toEqual(['relay-long/m', 'relay-new/glm']);
    expect(providerRow(s, 'relay-long')).toBeDefined();
  });

  test('renaming onto an existing providerId conflicts and changes nothing', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    addProvider(s, 'relay-taken');
    seedRoute(s, 'session', { provider: 'relay-old', modelId: 'glm' });
    expect(() => updateProvider(deps, s.team.id, pid, { providerId: 'relay-taken' })).toThrow(
      HttpError,
    );
    expect(providerRow(s, 'relay-old')?.id).toBe(pid);
    expect(s.db.select().from(routingRule).get()?.provider).toBe('relay-old');
  });

  test('a patch with an unchanged or absent providerId rewrites nothing', async () => {
    const { s, deps } = world();
    const pid = addProvider(s, 'relay-old');
    seedRoute(s, 'session', { provider: 'relay-old', modelId: 'glm' });
    updateProvider(deps, s.team.id, pid, { providerId: 'relay-old', label: 'same' });
    expect(providerRow(s, 'relay-old')?.label).toBe('same');
    expect(s.db.select().from(routingRule).get()?.provider).toBe('relay-old');
    updateProvider(deps, s.team.id, pid, { label: 'same-2' });
    expect(providerRow(s, 'relay-old')?.label).toBe('same-2');
  });

  test('the PATCH route performs the rename end to end', async () => {
    const { s } = world();
    const pid = addProvider(s, 'relay-old');
    seedRoute(s, 'session', { provider: 'relay-old', modelId: 'glm' });
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/providers/${pid}`, {
      providerId: 'relay-new',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { providerId: string }).providerId).toBe('relay-new');
    expect(s.db.select().from(routingRule).get()?.provider).toBe('relay-new');
  });
});
