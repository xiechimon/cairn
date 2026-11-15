import type { ClaudeCodeReport } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chiefMessage,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { CHIEF_REPLAY_MAX_CHARS } from '../src/services/chief-replay.js';
import {
  setCoordinatorInServer,
  setCoordinatorServerContextEnabled,
} from '../src/services/coordinator-context.js';
import { coordinatorRouteVerdict } from '../src/services/coordinator-route.js';
import { claimStep } from '../src/services/machines.js';
import { bootServer, insertMachine, seedRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  setCoordinatorInServer(false);
  setCoordinatorServerContextEnabled(false);
});

const LEAKED = `sk-ant-oat01-${'Zq9XvB2m'.repeat(8)}`;

function world(provider = 'claude-code') {
  setCoordinatorInServer(true);
  setCoordinatorServerContextEnabled(true);
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  disposables.push(() => s.dispose());
  const report = {
    installed: true,
    hostname: 'omarchy',
    models: [{ id: 'sonnet', name: 'sonnet' }],
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
  } as ClaudeCodeReport;
  const machineId = insertMachine(s, { name: 'omarchy', claudeCodeReport: report });
  s.db
    .update(machineTable)
    .set({ enabledRuntimes: ['pi', 'claude-code'] })
    .where(eq(machineTable.id, machineId))
    .run();
  seedRoute(s, 'coordinator', {
    provider,
    modelId: 'sonnet',
    thinkingLevel: 'off',
    machineId,
  });
  s.db
    .insert(chiefTable)
    .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, charter: '', createdAt: 1 })
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: 't1',
      chiefId: 'c1',
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'x',
      createdAt: 2,
      updatedAt: 2,
      sessionId: '',
      sessionOpenedAt: 2,
    })
    .run();
  return { s, machineId };
}

function message(
  s: TestServer,
  id: string,
  role: 'user' | 'assistant',
  content: unknown,
  createdAt: number,
): void {
  s.db.insert(chiefMessage).values({ id, threadId: 't1', role, content, createdAt }).run();
}

function chiefStep(s: TestServer, id: string, createdAt: number, ownerMessageIds: string[]): void {
  s.db
    .insert(stepTable)
    .values({
      id,
      buildId: 't1',
      kind: 'chief',
      status: 'pending',
      createdAt,
      ownerMessageIds,
    })
    .run();
}

function claimAs(s: TestServer, machineId: string) {
  return claimStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    machineId,
    s.team.id,
    10,
    'http://localhost',
  );
}

const replayOf = (systemPrompt: string | undefined): string | null => {
  const at = systemPrompt?.indexOf('## 此前的对话') ?? -1;
  return at === -1 ? null : (systemPrompt?.slice(at) ?? null);
};

describe('Coordinator rule that selects Claude Code', () => {
  test('the server never takes the turn; a rule without a provider row still refuses', () => {
    const { s } = world();
    expect(coordinatorRouteVerdict(s.db, s.team.id)).toBeNull();
    const other = world('ghost-provider');
    expect(coordinatorRouteVerdict(other.s.db, other.s.team.id)).toMatchObject({
      refusal: 'rule-provider-missing',
    });
  });

  test('the Runner claims a thread that has history from before its first Runner turn, and every later turn carries the same replay', async () => {
    const { s, machineId } = world();
    message(s, 'm1', 'user', 'plan the release', 10);
    message(s, 'm2', 'assistant', 'I drafted the plan', 11);
    message(s, 'm3', 'user', `my key is ${LEAKED}`, 12);
    message(
      s,
      'm4',
      'assistant',
      { kind: 'toolcall', call: { name: 'projects', arguments: {} } },
      13,
    );
    message(s, 'm5', 'user', 'what is next?', 20);
    chiefStep(s, 's1', 21, ['m5']);
    const first = await claimAs(s, machineId);
    expect(first?.step.id).toBe('s1');
    const replay = replayOf(first?.chief?.systemPrompt);
    expect(replay).toContain('plan the release');
    expect(replay).toContain('I drafted the plan');
    expect(replay).not.toContain(LEAKED);
    expect(replay).toContain('[REDACTED]');
    expect(replay).not.toContain('projects');
    expect(replay).not.toContain('what is next?');

    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, 's1')).run();
    message(s, 'm6', 'assistant', 'next is review', 22);
    message(s, 'm7', 'user', 'and after?', 30);
    chiefStep(s, 's2', 31, ['m7']);
    const second = await claimAs(s, machineId);
    expect(second?.step.id).toBe('s2');
    expect(replayOf(second?.chief?.systemPrompt)).toBe(replay);
  });

  test('a thread that began on Claude Code gets no replay section', async () => {
    const { s, machineId } = world();
    message(s, 'm1', 'user', 'first message', 10);
    chiefStep(s, 's1', 11, ['m1']);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe('s1');
    expect(replayOf(claimed?.chief?.systemPrompt)).toBeNull();
  });

  test('the replay keeps the newest lines within the cap', async () => {
    const { s, machineId } = world();
    for (let i = 0; i < 40; i++) {
      message(
        s,
        `h${i}`,
        i % 2 === 0 ? 'user' : 'assistant',
        `line ${i} ${'x'.repeat(400)}`,
        10 + i,
      );
    }
    message(s, 'cur', 'user', 'now', 100);
    chiefStep(s, 's1', 101, ['cur']);
    const claimed = await claimAs(s, machineId);
    const replay = replayOf(claimed?.chief?.systemPrompt) ?? '';
    expect(replay.length).toBeLessThanOrEqual(CHIEF_REPLAY_MAX_CHARS + 200);
    expect(replay).toContain('line 39 ');
    expect(replay).not.toContain('line 0 ');
  });

  test('a thread that ran on a Runner, then in the server, then on a Runner again replays the server era', async () => {
    const { s, machineId } = world();
    message(s, 'a1', 'user', 'runner era question', 10);
    chiefStep(s, 'old-runner', 11, ['a1']);
    s.db
      .update(stepTable)
      .set({ status: 'done', machineId, claimedAt: 11 })
      .where(eq(stepTable.id, 'old-runner'))
      .run();
    message(s, 'a2', 'assistant', 'runner era answer', 12);
    message(s, 'a3', 'user', 'server era question', 20);
    chiefStep(s, 'server-turn', 21, ['a3']);
    s.db
      .update(stepTable)
      .set({ status: 'done', claimedAt: 21 })
      .where(eq(stepTable.id, 'server-turn'))
      .run();
    message(s, 'a4', 'assistant', 'server era answer', 22);
    message(s, 'a5', 'user', 'back on claude', 30);
    chiefStep(s, 'new-runner', 31, ['a5']);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe('new-runner');
    const replay = replayOf(claimed?.chief?.systemPrompt);
    expect(replay).toContain('server era answer');
    expect(replay).toContain('runner era answer');
    expect(replay).not.toContain('back on claude');
  });

  test('a mail turn never carries the replay', async () => {
    const { s, machineId } = world();
    s.db
      .update(machineTable)
      .set({ latestCliVersion: '99.0.0' })
      .where(eq(machineTable.id, machineId))
      .run();
    message(s, 'm1', 'user', 'earlier talk', 10);
    s.db
      .insert(stepTable)
      .values({
        id: 'mail1',
        buildId: 't1',
        kind: 'chief',
        status: 'pending',
        createdAt: 20,
        prompt: '[wake:wake] provenance=mail:abc\nnew mail',
        ownerMessageIds: [],
      })
      .run();
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe('mail1');
    expect(replayOf(claimed?.chief?.systemPrompt)).toBeNull();
  });

  test('tool-heavy threads still replay the conversation behind the tool calls', async () => {
    const { s, machineId } = world();
    message(s, 'h1', 'user', 'a question from long ago', 5);
    message(s, 'h2', 'assistant', 'an answer from long ago', 6);
    for (let i = 0; i < 120; i++) {
      message(
        s,
        `tc${i}`,
        'assistant',
        { kind: 'toolcall', call: { name: 'projects', arguments: {} } },
        10 + i,
      );
    }
    message(s, 'cur', 'user', 'now', 200);
    chiefStep(s, 's1', 201, ['cur']);
    const claimed = await claimAs(s, machineId);
    const replay = replayOf(claimed?.chief?.systemPrompt) ?? '';
    expect(replay).toContain('an answer from long ago');
  });
});
