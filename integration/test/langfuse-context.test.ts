import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import {
  agentMemory,
  chief,
  chiefMessage,
  chiefSummary,
  chiefThread,
  chiefTurnUsage,
  machine,
  project,
  routingRule,
  step,
  team,
  user,
  workPolicy,
} from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { createEphemeralSecretBox } from '../../apps/server/src/lib/secret-box.js';
import { buildChiefSystemPrompt, sendChiefMessage } from '../../apps/server/src/services/chief.js';
import { TeamStreamHub } from '../../apps/server/src/services/events.js';
import { MachineWakeHub } from '../../apps/server/src/services/machine-wake-hub.js';
import { makeTestTempDir, releaseTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { runSandboxedTurn } from '../eval/coordinator-routing/sandbox.mts';
import { harvestReplayInput, harvestReplayItem } from '../eval/coordinator-routing/state.mts';
import { startStubLlm } from './stub-llm.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function world() {
  const opened = openDbWithHandle(':memory:');
  const home = makeTestTempDir('eval-context-');
  cleanup.push(() => releaseTestTempDir(home), opened.close);
  const { db } = opened;
  const seeded = seed(db);
  const deps = {
    db,
    user: seeded.user,
    hub: new TeamStreamHub(),
    machineHub: new MachineWakeHub(),
    box: createEphemeralSecretBox(),
    skillsDir: join(home, 'skills'),
    reposDir: join(home, 'repos'),
    attachmentsDir: join(home, 'attachments'),
  };
  mkdirSync(deps.skillsDir);
  db.insert(routingRule)
    .values({
      id: 'source-route',
      teamId: seeded.team.id,
      use: 'coordinator',
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'low',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const sent = sendChiefMessage(deps, seeded.team.id, { threadId: null, content: 'Hello' });
  const harvest = () => harvestReplayInput(db, sent.message.id, deps);
  return { ...seeded, db, deps, sent, harvest };
}

describe('harvest replay context closure', () => {
  it('accepts a default world through the production prompt and turn context', async () => {
    const w = world();
    const before = w.db.select().from(agentMemory).all();
    expect(w.harvest()).toMatchObject({ request: 'Hello', projects: [] });
    expect(w.db.select().from(agentMemory).all()).toEqual(before);
    const harvested = w.harvest();
    const systemPrompt = buildChiefSystemPrompt(w.deps, w.team.id, w.sent.thread.id).text;
    const model = await startStubLlm([{ content: 'Hello back' }]);
    cleanup.push(() => model.close());
    await expect(
      runSandboxedTurn(
        harvested,
        {
          kind: 'http',
          providerId: 'openai-codex',
          api: 'openai-completions',
          baseUrl: model.url,
          models: [{ id: 'gpt-6.1-sol', name: 'test' }],
        },
        'test-key',
        30_000,
      ),
    ).resolves.toMatchObject({ decision: 'answer' });
    expect(
      model.requests[0]?.messages.find((message) => message.role === 'system')?.content,
    ).toContain(systemPrompt);
    expect(
      harvestReplayItem(
        w.db,
        w.sent.message.id,
        { decision: 'answer', parts: [], askCandidates: [], blockedBy: [] },
        w.deps,
      ).input.request,
    ).toBe('Hello');
    expect(() =>
      harvestReplayItem(
        w.db,
        w.sent.message.id,
        { decision: 'route', parts: [{ project: 'missing' }], askCandidates: [], blockedBy: [] },
        w.deps,
      ),
    ).toThrow('expectedOutput');
  });

  it.each(['user', 'assistant', 'system', 'digest', 'prior step', 'summary', 'usage'])(
    'rejects unreproduced history: %s',
    (kind) => {
      const w = world();
      if (kind === 'prior step')
        w.db
          .insert(step)
          .values({
            id: 'earlier',
            buildId: w.sent.thread.id,
            kind: 'chief',
            status: 'done',
            createdAt: 1,
          })
          .run();
      else if (kind === 'summary')
        w.db
          .insert(chiefSummary)
          .values({
            threadId: w.sent.thread.id,
            summary: 'Earlier',
            coveredThroughId: 'earlier',
            coveredAt: 1,
            coveredRowid: 1,
            compactedMessages: 1,
            generation: 1,
            updatedAt: 1,
          })
          .run();
      else if (kind === 'usage')
        w.db
          .insert(chiefTurnUsage)
          .values({
            stepId: 'earlier',
            threadId: w.sent.thread.id,
            model: 'openai-codex/gpt-6.1-sol',
            createdAt: 1,
          })
          .run();
      else
        w.db
          .insert(chiefMessage)
          .values({
            id: kind === 'digest' ? 'chief-digest-earlier' : 'earlier',
            threadId: w.sent.thread.id,
            role: kind === 'digest' ? 'system' : (kind as 'user' | 'assistant' | 'system'),
            content: kind === 'digest' ? { kind: 'chief-digest', items: [] } : 'Earlier',
            createdAt: 1,
          })
          .run();
      expect(w.harvest).toThrow(/incomplete: replay context.*history/);
    },
  );

  it.each([
    ['name', 'Custom team'],
    ['plan', 'pro'],
    ['claudeUsage', 'api'],
    ['avatarStyle', 'other'],
    ['coAuthorTrailer', false],
    ['requestInstructorReview', true],
    ['maxAutonomousMergesPerDay', 2],
    ['firstPrReportPromptEnabled', true],
    ['firstPrReportPromptDismissedAt', 1],
    ['firstPrReportPromptFirstPrAt', 1],
    ['firstPrReportPromptFirstPrNumber', 1],
    ['namedPrompts', {}],
  ])('rejects non-default team.%s', (field, value) => {
    const w = world();
    w.db
      .update(team)
      .set({ [field]: value })
      .where(eq(team.id, w.team.id))
      .run();
    expect(w.harvest).toThrow(new RegExp(`incomplete: replay context.*team\\.${field}`));
  });

  it.each([
    ['displayName', 'Someone'],
    ['avatarUrl', 'https://example.com/avatar'],
  ])('rejects unseeded user.%s', (field, value) => {
    const w = world();
    w.db
      .update(user)
      .set({ [field]: value })
      .run();
    expect(w.harvest).toThrow(/incomplete: replay context.*user/);
  });

  it('rejects a work policy absent from the worker', () => {
    const w = world();
    w.db
      .insert(workPolicy)
      .values({
        id: 'policy',
        teamId: w.team.id,
        use: 'session',
        tools: [],
        mcpServers: [],
        secrets: [],
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect(w.harvest).toThrow(/incomplete: replay context.*policies/);
  });

  it('rejects a route absent from the worker', () => {
    const w = world();
    w.db
      .insert(routingRule)
      .values({
        id: 'session',
        teamId: w.team.id,
        use: 'session',
        provider: 'openai-codex',
        modelId: 'gpt-6.1-sol',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect(w.harvest).toThrow(/incomplete: replay context.*routes/);
  });

  it.each(['docs', 'todos', 'attachment', 'memories'])(
    'rejects source %s tool inputs the worker cannot seed',
    (name) => {
      const w = world();
      w.db
        .insert(chiefMessage)
        .values({
          id: 'tool',
          threadId: w.sent.thread.id,
          role: 'assistant',
          content: { kind: 'toolcall', call: { name } },
          createdAt:
            w.db.select().from(step).where(eq(step.id, w.sent.message.id)).get()!.createdAt + 1,
        })
        .run();
      expect(w.harvest).toThrow(/incomplete: replay context.*source tool/);
    },
  );

  it('rejects attachment grants tied to the source team', () => {
    const w = world();
    const content = `Hello\n![file](attachment:${w.team.id}/file.txt)`;
    w.db.update(chiefMessage).set({ content }).run();
    w.db.update(step).set({ prompt: content }).run();
    expect(w.harvest).toThrow(/incomplete: replay context.*attachments/);
  });

  it('rejects a charter', () => {
    const w = world();
    w.db.update(chief).set({ charter: 'Route everything to docs' }).run();
    expect(w.harvest).toThrow(/incomplete: replay context.*systemPrompt/);
  });

  it.each(['core', 'scratchpad', 'searchable'] as const)('rejects %s memory', (layer) => {
    const w = world();
    w.db
      .insert(agentMemory)
      .values({
        id: 'memory',
        agentId: 'source-route',
        teamId: w.team.id,
        title: 'Preference',
        content: 'Use docs',
        layer,
        threadId: w.sent.thread.id,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect(w.harvest).toThrow(/incomplete: replay context/);
  });

  it('rejects skills even without a matching route hint', () => {
    const w = world();
    mkdirSync(join(w.deps.skillsDir, 'other'));
    writeFileSync(
      join(w.deps.skillsDir, 'other', 'SKILL.md'),
      '---\nname: other\ndescription: Unrelated workflow\n---\nDo other work.',
    );
    expect(w.harvest).toThrow(/incomplete: replay context.*systemPrompt/);
  });

  it.each([
    ['githubRepo', 'example/repo'],
    ['instructions', 'Use this project'],
    ['group', 'group'],
    ['repoName', 'repo'],
    ['localPath', '/workspace/repo'],
    ['baseBranch', 'develop'],
    ['splitPolicy', 'auto'],
    ['evidenceStore', 'repository'],
    ['maxConcurrent', 2],
    ['icon', 'code'],
    ['color', 'rose'],
    ['autonomy', { mergePolicy: 'human' }],
  ])('rejects unseeded project.%s', (field, value) => {
    const w = world();
    w.db
      .insert(project)
      .values({ id: 'p', teamId: w.team.id, name: 'docs', [field]: value })
      .run();
    expect(w.harvest).toThrow(new RegExp(`incomplete: replay context.*projects.*${field}`));
  });

  it.each([
    ['prompt', 'Hello plus a direct thread note'],
    ['scopeProjectId', 'unseeded'],
    ['ownerMessageIds', []],
    ['skillInjection', { skillId: 'other' }],
    ['promptOrigin', { kind: 'wake' }],
    ['fallback', { provider: 'other' }],
    ['sessionId', 'old-session'],
    ['freshSession', true],
    ['byPerson', true],
    ['scheduleId', 'schedule'],
    ['scheduledBy', 'timer'],
    ['blockerHandoff', {}],
    ['machineId', 'daemon'],
  ])('rejects unseeded step.%s', (field, value) => {
    const w = world();
    w.db
      .update(step)
      .set({ [field]: value })
      .run();
    expect(w.harvest).toThrow(/incomplete: replay context/);
  });

  it.each([
    ['provider', 'claude-code'],
    ['modelId', 'other'],
    ['thinkingLevel', 'high'],
    ['machineId', 'other'],
    ['mcpServers', ['other']],
    ['fallbackModels', []],
    ['requiredCapabilities', { models: ['other'] }],
  ])('rejects unseeded coordinator route.%s', (field, value) => {
    const w = world();
    if (field === 'machineId')
      w.db.insert(machine).values({ id: 'other', teamId: w.team.id, name: 'Other' }).run();
    w.db
      .update(routingRule)
      .set({ [field]: value })
      .run();
    expect(w.harvest).toThrow(/incomplete: replay context.*route/);
  });

  it.each([
    ['projectId', 'missing'],
    ['sessionRuntime', 'claude'],
    ['pendingSessionResumeAt', 1],
    ['toolDefHashes', { tool: 'old' }],
    ['toolResultHashes', { tool: 'old' }],
    ['archivedAt', 1],
  ])('rejects unreproduced thread.%s', (field, value) => {
    const w = world();
    w.db
      .update(chiefThread)
      .set({ [field]: value })
      .run();
    expect(w.harvest).toThrow(/incomplete: replay context.*thread/);
  });

  it('rejects an unknown skills directory instead of assuming it is empty', () => {
    const w = world();
    expect(() =>
      harvestReplayInput(w.db, w.sent.message.id, {
        ...w.deps,
        skillsDir: join(w.deps.skillsDir, 'missing'),
      }),
    ).toThrow(/incomplete: replay context.*skills/);
    expect(() => harvestReplayInput(w.db, w.sent.message.id)).toThrow(
      /incomplete: replay context.*resources/,
    );
  });

  it('rejects history even when it shares the source timestamp', () => {
    const w = world();
    w.db
      .insert(chiefMessage)
      .values({
        id: 'same-time',
        threadId: w.sent.thread.id,
        role: 'user',
        content: 'Steer',
        createdAt: w.sent.message.createdAt,
      })
      .run();
    expect(w.harvest).toThrow(/incomplete: replay context.*history/);
  });
});
