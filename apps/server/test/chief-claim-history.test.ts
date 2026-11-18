import type { ClaudeCodeReport } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chiefMessage,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  CHIEF_HISTORY_LINE_MAX_CHARS,
  CHIEF_HISTORY_MAX_CHARS,
} from '../src/services/chief-claim-history.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { claimStep } from '../src/services/machines.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertMachine,
  seedRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  setCoordinatorInServer(false);
});

function world(provider = 'claude-code') {
  setCoordinatorInServer(true);
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  insertClaudeSubscription(s);
  disposables.push(() => s.dispose());
  const report = {
    installed: true,
    hostname: 'omarchy',
    models: [{ id: 'sonnet', name: 'sonnet' }],
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
  } as ClaudeCodeReport;
  const machineId = insertMachine(s, { name: 'omarchy', claudeCodeReport: report });
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

const LEAKED = `sk-ant-oat01-${'Zq9XvB2m'.repeat(8)}`;

function message(
  s: TestServer,
  id: string,
  role: 'user' | 'assistant' | 'system',
  content: unknown,
  createdAt: number,
): void {
  s.db.insert(chiefMessage).values({ id, threadId: 't1', role, content, createdAt }).run();
}

function chiefStep(
  s: TestServer,
  id: string,
  createdAt: number,
  extra: Partial<typeof stepTable.$inferInsert> = {},
): void {
  s.db
    .insert(stepTable)
    .values({ id, buildId: 't1', kind: 'chief', status: 'pending', createdAt, ...extra })
    .run();
}

async function historyOf(s: TestServer, machineId: string) {
  const claimed = await claimAs(s, machineId);
  return { claimed, history: claimed?.chief?.history };
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

describe('the earlier conversation carried to a Runner claim', () => {
  test('rows before the step are carried as fenced data; the current message, tool calls, daemon prompt rows, digests and system rows are not', async () => {
    const { s, machineId } = world();
    message(s, 'm1', 'user', 'plan the release', 10);
    message(s, 'm2', 'assistant', 'I drafted the plan', 11);
    message(
      s,
      'm3',
      'assistant',
      { kind: 'toolcall', call: { name: 'projects', arguments: {} } },
      12,
    );
    message(s, 'user-old-step', 'user', 'wrapped instruction with project sections', 13);
    message(s, 'chief-digest-1', 'assistant', { kind: 'unrelated', note: 'digest body' }, 14);
    message(s, 'm4', 'system', 'resume miss notice', 15);
    message(s, 'm5', 'user', 'what is next?', 20);
    chiefStep(s, 's1', 21, { ownerMessageIds: ['m5'] });
    const { claimed, history } = await historyOf(s, machineId);
    expect(claimed?.step.id).toBe('s1');
    expect(history).toContain('用户：plan the release');
    expect(history).toContain('Coordinator：I drafted the plan');
    for (const absent of [
      'what is next?',
      'projects',
      'wrapped instruction',
      'digest body',
      'resume miss',
    ]) {
      expect(history).not.toContain(absent);
    }
    const lines = (history ?? '').split('\n');
    expect(lines.slice(1, -1).every((line) => line === '>' || line.startsWith('> '))).toBe(true);
    expect(claimed?.chief?.systemPrompt).not.toContain('plan the release');
  });

  test('a secret in a message is redacted', async () => {
    const { s, machineId } = world();
    message(s, 'm1', 'user', `my key is ${LEAKED}`, 10);
    message(s, 'm2', 'assistant', 'noted', 11);
    chiefStep(s, 's1', 21);
    const { history } = await historyOf(s, machineId);
    expect(history).not.toContain(LEAKED);
    expect(history).toContain('[REDACTED]');
  });

  test('every conversational row appears; a tie on time is resolved by row order', async () => {
    const { s, machineId } = world();
    message(s, 'c1', 'user', 'covered one', 10);
    message(s, 'c2', 'assistant', 'covered two', 10);
    message(s, 'n1', 'user', 'after the cursor', 10);
    chiefStep(s, 's1', 21);
    const { history } = await historyOf(s, machineId);
    expect(history).toContain('covered one');
    expect(history).toContain('covered two');
    expect(history).toContain('after the cursor');
    expect(history?.indexOf('covered one')).toBeLessThan(history?.indexOf('covered two') ?? 0);
  });

  test('a thread whose newest rows are all tool calls still replays the conversation behind them', async () => {
    const { s, machineId } = world();
    message(s, 'h1', 'user', 'a question from long ago', 5);
    message(s, 'h2', 'assistant', 'an answer from long ago', 6);
    for (let i = 0; i < 400; i++) {
      message(
        s,
        `tc${i}`,
        'assistant',
        { kind: 'toolcall', call: { name: 'projects', arguments: {} } },
        10 + i,
      );
    }
    chiefStep(s, 's1', 1000);
    const { history } = await historyOf(s, machineId);
    expect(history).toContain('an answer from long ago');
  });

  test('the newest lines win under the cap, an oversized line is cut and does not empty the rest', async () => {
    const { s, machineId } = world();
    message(s, 'big', 'user', 'B'.repeat(CHIEF_HISTORY_LINE_MAX_CHARS * 3), 9);
    for (let i = 0; i < 60; i++) {
      message(
        s,
        `h${i}`,
        i % 2 === 0 ? 'user' : 'assistant',
        `line ${i} ${'x'.repeat(400)}`,
        10 + i,
      );
    }
    chiefStep(s, 's1', 1000);
    const { history } = await historyOf(s, machineId);
    expect((history ?? '').length).toBeLessThanOrEqual(CHIEF_HISTORY_MAX_CHARS + 1200);
    expect(history).toContain('line 59 ');
    expect(history).not.toContain('line 0 ');
    expect(history).not.toContain('B'.repeat(CHIEF_HISTORY_LINE_MAX_CHARS + 1));
    expect(history).toMatch(/> 用户：line 58|> Coordinator：line 59/);
  });

  test('a secret that straddles the per-line cut is redacted whole, not cut into a surviving fragment', async () => {
    const { s, machineId } = world();
    const key = `sk-ant-oat01-${'Zq9XvB2m'.repeat(8)}`;
    const lead = 'a'.repeat(CHIEF_HISTORY_LINE_MAX_CHARS - 3 - 16);
    message(s, 'm1', 'user', `${lead}${key} tail ${'z'.repeat(500)}`, 10);
    chiefStep(s, 's1', 21);
    const { history } = await historyOf(s, machineId);
    expect(history).toContain('[cut:');
    expect(history).not.toContain('sk-ant');
  });

  test('a row that is not valid JSON is skipped and never fails the claim', async () => {
    const { s, machineId } = world();
    s.db.run(
      sql`insert into chief_message (id, threadId, role, content, createdAt) values ('raw1', 't1', 'user', 'not json at all', 10)`,
    );
    message(s, 'm2', 'assistant', 'fine', 11);
    chiefStep(s, 's1', 21);
    const { claimed, history } = await historyOf(s, machineId);
    expect(claimed?.step.id).toBe('s1');
    expect(history).toContain('fine');
    expect(history).not.toContain('not json');
  });

  test('no history field for an empty thread, a digest step or a mail turn; the system prompt does not change with history', async () => {
    const empty = world();
    chiefStep(empty.s, 's1', 21);
    const first = await historyOf(empty.s, empty.machineId);
    expect(first.claimed?.step.id).toBe('s1');
    expect(first.claimed?.chief).not.toHaveProperty('history');

    const mail = world();
    mail.s.db
      .update(machineTable)
      .set({ latestCliVersion: '99.0.0' })
      .where(eq(machineTable.id, mail.machineId))
      .run();
    message(mail.s, 'm1', 'user', 'earlier talk', 10);
    chiefStep(mail.s, 'mail1', 20, { prompt: '[wake:wake] provenance=mail:abc\nnew mail' });
    const mailClaim = await historyOf(mail.s, mail.machineId);
    expect(mailClaim.claimed?.step.id).toBe('mail1');
    expect(mailClaim.claimed?.chief).not.toHaveProperty('history');

    const plain = world();
    chiefStep(plain.s, 's1', 21);
    const withoutHistory = await historyOf(plain.s, plain.machineId);
    const talked = world();
    message(talked.s, 'm1', 'user', 'earlier talk', 10);
    chiefStep(talked.s, 's1', 21);
    const withHistory = await historyOf(talked.s, talked.machineId);
    expect(withHistory.history).toContain('earlier talk');
    expect(withHistory.claimed?.chief?.systemPrompt).toBe(
      withoutHistory.claimed?.chief?.systemPrompt,
    );
  });
});

describe('a project Coordinator model on a Runner', () => {
  test('a Claude Code project model replaces the team model in the claim; a provider the team never added falls back to the team model', async () => {
    const { s, machineId } = world();
    const choose = (provider: string, modelId: string) => {
      s.db
        .insert(projectTable)
        .values({
          id: `p-${modelId}`,
          name: modelId,
          teamId: s.team.id,
          modelOverrides: { coordinator: { provider, modelId, thinkingLevel: null } },
        })
        .run();
      s.db
        .update(chiefThreadTable)
        .set({ projectId: `p-${modelId}` })
        .where(eq(chiefThreadTable.id, 't1'))
        .run();
    };
    choose('claude-code', 'opus');
    chiefStep(s, 's1', 100);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.agent).toMatchObject({ provider: 'claude-code', modelId: 'opus' });
    expect(claimed?.agent?.thinkingLevel).toBeNull();
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, 's1')).run();
    choose('anthropic', 'claude-haiku-5-5');
    chiefStep(s, 's2', 200);
    expect((await claimAs(s, machineId))?.agent).toMatchObject({
      provider: 'claude-code',
      modelId: 'sonnet',
    });
  });
});
