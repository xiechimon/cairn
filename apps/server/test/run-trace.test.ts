import {
  RUN_TRACE_VALUE_CAP,
  type RunListPage,
  type RunTrace,
  transcriptPromptRowId,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  build,
  chiefMessage,
  chiefThread,
  chiefTurnUsage,
  message,
  project,
  step,
  team,
  todo,
  tokenUsage,
} from '../src/db/schema.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

const T0 = 1_795_700_000_000;
const fakeKey = `sk-${'z'.repeat(28)}`;

function chiefStep(id: string, at: number, over: Partial<typeof step.$inferInsert> = {}) {
  return {
    id,
    buildId: H.threadId,
    kind: 'chief' as const,
    status: 'done' as const,
    createdAt: at,
    claimedAt: at + 10,
    finishedAt: at + 5_000,
    ownerMessageIds: [`owner-${id}`],
    ...over,
  };
}

function chiefRow(id: string, at: number, role: 'user' | 'assistant' | 'system', content: unknown) {
  return { id, threadId: H.threadId, role, content, createdAt: at };
}

function toolRow(id: string, at: number, name: string, isError = false) {
  return chiefRow(id, at, 'assistant', {
    kind: 'toolcall',
    call: {
      id,
      name,
      arguments: { q: name },
      result: `${name} output`,
      isError,
      startedAt: at,
      endedAt: at + 50,
    },
  });
}

function seedTurns() {
  H.s.db
    .insert(step)
    .values([
      chiefStep('turn-a', T0),
      chiefStep('turn-b', T0 + 10_000, { status: 'failed', finishedAt: T0 + 14_000 }),
      chiefStep('turn-c', T0 + 20_000, { finishedAt: null, ownerMessageIds: null }),
    ])
    .run();
  H.s.db
    .insert(chiefMessage)
    .values([
      chiefRow('owner-turn-a', T0, 'user', '看看项目'),
      chiefRow(
        transcriptPromptRowId('turn-a'),
        T0 + 20,
        'user',
        '看看项目\n\n<turn_state>Now</turn_state>',
      ),
      toolRow('call_a1', T0 + 100, 'projects'),
      chiefRow('msg-turn-a-1', T0 + 200, 'assistant', [{ type: 'text', text: '有两个项目。' }]),
      toolRow('call_a_late', T0 + 6_000, 'todos'),
      chiefRow('owner-turn-b', T0 + 10_000, 'user', `打开 x.com ${fakeKey}`),
      toolRow('call_b_edge', T0 + 10_010, 'todos'),
      toolRow('call_b0', T0 + 10_050, 'browser'),
      chiefRow('msg-turn-b-1', T0 + 10_100, 'assistant', [
        { type: 'thinking', thinking: 'Open the browser first.' },
      ]),
      toolRow('call_b1', T0 + 10_200, 'browser'),
      toolRow('call_b2', T0 + 10_300, 'browser', true),
      chiefRow(
        'chief-err-turn-b',
        T0 + 14_010,
        'system',
        JSON.stringify({ kind: 'chief_turn_error', message: 'Runner error: ENOSPC' }),
      ),
      chiefRow('turn-c', T0 + 20_000, 'user', '再来一次'),
      chiefRow('native-store1:turn-c-t7', T0 + 20_100, 'assistant', [
        { type: 'thinking', thinking: 'In-server thought.' },
      ]),
      chiefRow('native-store1:turn-c-e7', T0 + 20_100, 'assistant', [
        { type: 'text', text: '好了。' },
      ]),
    ])
    .run();
  H.s.db
    .insert(chiefTurnUsage)
    .values({
      stepId: 'turn-b',
      threadId: H.threadId,
      model: 'stub-gw/stub-model',
      input: 40,
      output: 5,
      createdAt: T0,
    })
    .run();
}

async function getJson<T>(path: string, status = 200): Promise<T> {
  const res = await H.s.app.request(path);
  expect(res.status).toBe(status);
  return (await res.json()) as T;
}

function seedOtherTeam() {
  H.s.db.insert(team).values({ id: 'team-other', name: 'Other', createdAt: 1 }).run();
  H.s.db.insert(project).values({ id: 'project-other', name: 'other', teamId: 'team-other' }).run();
  H.s.db
    .insert(chiefThread)
    .values({
      id: 'chief-other',
      chiefId: 'chief-x',
      userId: H.userId,
      teamId: 'team-other',
      title: 'theirs',
      createdAt: T0,
      updatedAt: T0,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: T0,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
  H.s.db
    .insert(step)
    .values({
      id: 'turn-theirs',
      buildId: 'chief-other',
      kind: 'chief',
      status: 'failed',
      createdAt: T0,
    })
    .run();
}

describe('run trace', () => {
  test('a failed Coordinator turn reads as one run: what was sent, thinking, tools, the error, redacted', async () => {
    seedTurns();
    const trace = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-b`);
    expect(trace).toMatchObject({
      kind: 'coordinator',
      id: 'turn-b',
      threadId: H.threadId,
      status: 'failed',
      models: ['stub-gw/stub-model'],
      usage: { input: 40, output: 5 },
      failure: { text: 'Runner error: ENOSPC', itemId: 'call_b2' },
    });
    expect(trace.items.map((i) => i.kind)).toEqual([
      'user',
      'tool',
      'thinking',
      'tool',
      'tool',
      'error',
    ]);
    expect(trace.items[4]).toMatchObject({
      name: 'browser',
      isError: true,
      result: 'browser output',
    });
    expect(JSON.stringify(trace)).not.toContain(fakeKey);
  });

  test('each tool call belongs to exactly one turn; a row stamped at the next claim is the last write of the earlier turn', async () => {
    seedTurns();
    const a = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-a`);
    expect(a.items.map((i) => [i.kind, i.id])).toEqual([
      ['user', 'owner-turn-a'],
      ['prompt', transcriptPromptRowId('turn-a')],
      ['tool', 'call_a1'],
      ['reply', 'msg-turn-a-1'],
      ['tool', 'call_a_late'],
      ['tool', 'call_b_edge'],
    ]);
    expect(a).toMatchObject({
      title: '看看项目',
      failure: null,
    });
    const b = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-b`);
    expect(b.items.filter((i) => i.kind === 'tool').map((i) => i.id)).toEqual([
      'call_b0',
      'call_b1',
      'call_b2',
    ]);
  });

  test('the page caps long tool output and says so; the export keeps it whole', async () => {
    seedTurns();
    const huge = 'y'.repeat(RUN_TRACE_VALUE_CAP * 3);
    H.s.db
      .insert(chiefMessage)
      .values(
        chiefRow('call_huge', T0 + 300, 'assistant', {
          kind: 'toolcall',
          call: { id: 'call_huge', name: 'read', arguments: {}, result: huge, isError: false },
        }),
      )
      .run();
    const page = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-a`);
    const cut = page.items.find((i) => i.id === 'call_huge');
    expect(cut).toMatchObject({ truncated: true });
    expect(cut?.kind === 'tool' && String(cut.result).length).toBe(RUN_TRACE_VALUE_CAP);
    expect(page.items.find((i) => i.id === 'call_a1')).toMatchObject({ truncated: false });
    const res = await H.s.app.request(`/api/teams/${H.teamId}/runs/turn-a?download=1`);
    const file = JSON.parse(await res.text()) as RunTrace;
    expect(file.items.find((i) => i.id === 'call_huge')).toMatchObject({
      truncated: false,
      result: huge,
    });
  });

  test('a secret that straddles the cap is redacted before the cut, so no prefix of it reaches the page', async () => {
    seedTurns();
    const straddle = `${'x'.repeat(RUN_TRACE_VALUE_CAP - 12)}${fakeKey}`;
    H.s.db
      .insert(chiefMessage)
      .values(
        chiefRow('call_secret', T0 + 300, 'assistant', {
          kind: 'toolcall',
          call: {
            id: 'call_secret',
            name: 'read',
            arguments: { auth: straddle },
            result: straddle,
            isError: false,
          },
        }),
      )
      .run();
    const page = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-a`);
    expect(page.items.some((i) => i.id === 'call_secret')).toBe(true);
    expect(JSON.stringify(page)).not.toContain(fakeKey.slice(0, 10));
  });

  test('a turn that never started owns no tool rows and shows no start or duration of its own', async () => {
    H.s.db
      .insert(step)
      .values([
        chiefStep('turn-p', T0),
        chiefStep('turn-q', T0 + 10_000, {
          status: 'stopped',
          claimedAt: null,
          finishedAt: T0 + 11_000,
        }),
        chiefStep('turn-r', T0 + 20_000),
      ])
      .run();
    H.s.db
      .insert(chiefMessage)
      .values([toolRow('call_p', T0 + 100, 'projects'), toolRow('call_r', T0 + 20_100, 'todos')])
      .run();
    const p = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-p`);
    expect(p.items.filter((i) => i.kind === 'tool').map((i) => i.id)).toEqual(['call_p']);
    const q = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-q`);
    expect(q).toMatchObject({ startedAt: T0 + 10_000, finishedAt: null });
    expect(q.items.filter((i) => i.kind === 'tool')).toEqual([]);
    const list = await getJson<RunListPage>(`/api/teams/${H.teamId}/runs?thread=${H.threadId}`);
    expect(list.runs.map((r) => [r.id, r.toolCount])).toEqual([
      ['turn-r', 1],
      ['turn-q', 0],
      ['turn-p', 1],
    ]);
  });

  test('an in-server turn with no owner list and no finish time still finds its message and thinking', async () => {
    seedTurns();
    const trace = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-c`);
    expect(trace.items.map((i) => i.kind)).toEqual(['user', 'thinking', 'reply']);
    expect(trace.finishedAt).toBeNull();
  });

  test('a task build reads as one run with its steps, tools, thinking and failure', async () => {
    H.s.db
      .insert(todo)
      .values({
        id: 'todo-1',
        teamId: H.teamId,
        projectId: H.projectId,
        title: 'fix it',
        phaseAt: T0,
        seqNum: 42,
        latestBuildId: 'build-1',
      })
      .run();
    H.s.db
      .insert(build)
      .values({
        id: 'build-1',
        todoId: 'todo-1',
        withPlan: false,
        triggerSource: 'user',
        errorMessage: 'push failed',
        createdAt: T0,
      })
      .run();
    H.s.db
      .insert(step)
      .values({
        id: 'step-1',
        buildId: 'build-1',
        kind: 'build',
        status: 'failed',
        createdAt: T0,
        claimedAt: T0 + 1,
        finishedAt: T0 + 900,
      })
      .run();
    H.s.db
      .insert(message)
      .values([
        {
          id: 'user-step-1',
          conversationId: 'build-1',
          role: 'user',
          content: 'fix it',
          createdAt: T0 + 2,
        },
        {
          id: 'msg-step-1-0',
          conversationId: 'build-1',
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Look first.' }],
          createdAt: T0 + 3,
        },
        {
          id: 'tc-1',
          conversationId: 'build-1',
          role: 'assistant',
          content: {
            kind: 'toolcall',
            call: {
              id: 'tc-1',
              name: 'Bash',
              arguments: { cmd: 'ls' },
              result: 'a b',
              isError: false,
            },
          },
          createdAt: T0 + 4,
        },
        {
          id: 'msg-step-1-1',
          conversationId: 'build-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Done.' }],
          createdAt: T0 + 5,
        },
      ])
      .run();
    H.s.db.insert(tokenUsage).values({ buildId: 'build-1', model: 'relay/glm', input: 7 }).run();
    for (const id of ['build-1', 'step-1']) {
      const trace = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/${id}`);
      expect(trace).toMatchObject({
        kind: 'task',
        id: 'build-1',
        todoId: 'todo-1',
        title: '#42 fix it',
        status: 'failed',
        usage: { input: 7 },
        failure: { text: 'push failed', itemId: null },
      });
      expect(trace.items.map((i) => i.kind)).toEqual([
        'step',
        'prompt',
        'thinking',
        'tool',
        'reply',
        'error',
      ]);
    }
    await getJson(`/api/teams/${H.teamId}/runs/todo-1`, 404);
  });

  test('only this team’s single runs open: other teams, threads, tasks and unknown ids are not found', async () => {
    seedTurns();
    seedOtherTeam();
    await getJson(`/api/teams/${H.teamId}/runs/turn-a`);
    for (const id of ['turn-theirs', 'chief-other', H.threadId, 'no-such-run'])
      await getJson(`/api/teams/${H.teamId}/runs/${id}`, 404);
    await getJson(`/api/teams/${H.teamId}/runs?thread=${H.threadId}`);
    await getJson(`/api/teams/${H.teamId}/runs?thread=chief-other`, 404);
    const all = await getJson<RunListPage>(`/api/teams/${H.teamId}/runs`);
    expect(all.runs.map((r) => r.id)).not.toContain('turn-theirs');
  });

  test('a reply or thought that starts with blank lines reads without the leading gap', async () => {
    seedTurns();
    H.s.db
      .insert(chiefMessage)
      .values(
        chiefRow('msg-turn-a-gap', T0 + 400, 'assistant', [
          { type: 'thinking', thinking: '\n\n先想一下' },
          { type: 'text', text: '\n\n无法直接执行。\n' },
        ]),
      )
      .run();
    const page = await getJson<RunTrace>(`/api/teams/${H.teamId}/runs/turn-a`);
    const texts = page.items
      .filter((i) => i.id.startsWith('msg-turn-a-gap'))
      .map((i) => (i.kind === 'reply' || i.kind === 'thinking' ? i.text : null));
    expect(texts).toEqual(['先想一下', '无法直接执行。']);
  });

  test('export downloads the same run as a JSON file', async () => {
    seedTurns();
    const res = await H.s.app.request(`/api/teams/${H.teamId}/runs/turn-b?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('cairn-run-turn-b.json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const file = JSON.parse(await res.text()) as RunTrace;
    const page = await H.s.app.request(`/api/teams/${H.teamId}/runs/turn-b`);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(file).toEqual(await page.json());
    expect(JSON.stringify(file)).not.toContain(fakeKey);
  });

  test('the turn list pages newest first and filters to turns that went wrong', async () => {
    const rows = Array.from({ length: 45 }, (_, i) =>
      chiefStep(`t${String(i).padStart(2, '0')}`, T0 + (i === 24 ? 25 : i) * 1_000, {
        status: i % 9 === 0 ? 'failed' : i % 9 === 1 ? 'stopped' : 'done',
        ...(i === 44 ? { quotaBlock: { reason: 'quota', retryAt: T0 } as never } : {}),
      }),
    );
    H.s.db.insert(step).values(rows).run();
    H.s.db
      .insert(chiefMessage)
      .values(chiefRow('owner-t44', T0 + 44_000, 'user', '最后一条\n第二行'))
      .run();
    const base = `/api/teams/${H.teamId}/runs?thread=${H.threadId}`;
    const first = await getJson<RunListPage>(base);
    expect(first.runs).toHaveLength(20);
    expect(first.runs[0]).toMatchObject({
      id: 't44',
      kind: 'coordinator',
      threadId: H.threadId,
      status: 'quota',
      firstLine: '最后一条',
      woke: false,
      durationMs: 4_990,
    });
    const second = await getJson<RunListPage>(`${base}&before=${first.nextCursor}`);
    expect(second.runs[0]?.id).toBe('t24');
    const third = await getJson<RunListPage>(`${base}&before=${second.nextCursor}`);
    expect(third.runs.map((r) => r.id)).toEqual(['t04', 't03', 't02', 't01', 't00']);
    expect(third.nextCursor).toBeNull();
    const problems = await getJson<RunListPage>(`${base}&problems=1`);
    expect(problems.runs.map((r) => [r.id, r.status])).toEqual([
      ['t44', 'quota'],
      ['t37', 'stopped'],
      ['t36', 'failed'],
      ['t28', 'stopped'],
      ['t27', 'failed'],
      ['t19', 'stopped'],
      ['t18', 'failed'],
      ['t10', 'stopped'],
      ['t09', 'failed'],
      ['t01', 'stopped'],
      ['t00', 'failed'],
    ]);
  });
  test('全部 merges every team thread with task runs newest first, pages across both without gaps, and skips hidden or foreign threads', async () => {
    const thread = (id: string, over: Partial<typeof chiefThread.$inferInsert> = {}) => ({
      id,
      chiefId: `chief-of-${id}`,
      userId: H.userId,
      teamId: H.teamId,
      title: id,
      createdAt: T0,
      updatedAt: T0,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: T0,
      toolDefHashes: {},
      toolResultHashes: {},
      ...over,
    });
    seedOtherTeam();
    H.s.db
      .insert(chiefThread)
      .values([
        thread('chief-channel', { projectId: H.projectId }),
        thread('chief-archived', { archivedAt: T0 }),
        thread('chief-digest-x'),
        thread('chief-memory-x'),
      ])
      .run();
    H.s.db
      .insert(todo)
      .values({
        id: 'todo-r',
        teamId: H.teamId,
        projectId: H.projectId,
        title: '修复设置页 390 宽度下的横向滚动',
        phaseAt: T0,
        seqNum: 7,
      })
      .run();
    H.s.db
      .insert(build)
      .values([
        {
          id: 'b-done',
          todoId: 'todo-r',
          withPlan: false,
          triggerSource: 'user',
          createdAt: T0 + 3_000,
        },
        {
          id: 'b-live',
          todoId: 'todo-r',
          withPlan: false,
          triggerSource: 'user',
          createdAt: T0 + 5_000,
        },
        {
          id: 'b-fail',
          todoId: 'todo-r',
          withPlan: false,
          triggerSource: 'user',
          errorMessage: 'push failed',
          createdAt: T0 + 1_000,
        },
      ])
      .run();
    H.s.db
      .insert(step)
      .values([
        chiefStep('m-1', T0 + 1_000, { status: 'failed' }),
        chiefStep('m-run', T0 + 6_000, { status: 'claimed', finishedAt: null }),
        chiefStep('c-1', T0 + 2_000, { buildId: 'chief-channel' }),
        chiefStep('a-1', T0 + 4_000, { buildId: 'chief-archived', status: 'stopped' }),
        chiefStep('c-2', T0 + 3_000, { buildId: 'chief-channel' }),
        chiefStep('d-1', T0 + 4_500, { buildId: 'chief-digest-x' }),
        chiefStep('mem-1', T0 + 4_550, { buildId: 'chief-memory-x' }),
        chiefStep('gone-1', T0 + 4_600, { buildId: 'chief-deleted' }),
        {
          id: 'bs-done',
          buildId: 'b-done',
          kind: 'build',
          status: 'done',
          createdAt: T0 + 3_000,
          claimedAt: T0 + 3_100,
          finishedAt: T0 + 9_100,
        },
        {
          id: 'bs-live',
          buildId: 'b-live',
          kind: 'build',
          status: 'claimed',
          createdAt: T0 + 5_000,
          claimedAt: T0 + 5_100,
        },
        {
          id: 'bs-fail',
          buildId: 'b-fail',
          kind: 'build',
          status: 'failed',
          createdAt: T0 + 1_000,
          claimedAt: T0 + 1_100,
          finishedAt: T0 + 2_000,
        },
      ])
      .run();
    H.s.db
      .insert(message)
      .values(
        ['tc-x', 'tc-y'].map((id, n) => ({
          id,
          conversationId: 'b-done',
          role: 'assistant' as const,
          content: {
            kind: 'toolcall',
            call: { id, name: 'Bash', arguments: {}, result: '', isError: false },
          },
          createdAt: T0 + 3_200 + n,
        })),
      )
      .run();
    const base = `/api/teams/${H.teamId}/runs`;
    const all = await getJson<RunListPage>(base);
    expect(all.runs.map((r) => [r.id, r.kind, r.status])).toEqual([
      ['m-run', 'coordinator', 'running'],
      ['b-live', 'task', 'running'],
      ['a-1', 'coordinator', 'stopped'],
      ['c-2', 'coordinator', 'done'],
      ['b-done', 'task', 'done'],
      ['c-1', 'coordinator', 'done'],
      ['m-1', 'coordinator', 'failed'],
      ['b-fail', 'task', 'failed'],
    ]);
    expect(all.runs.find((r) => r.id === 'b-done')).toMatchObject({
      threadId: null,
      firstLine: '修复设置页 390 宽度下的横向滚动',
      source: 'demo',
      toolCount: 2,
      durationMs: 6_000,
    });
    expect(all.runs.find((r) => r.id === 'm-run')).toMatchObject({
      durationMs: null,
      source: null,
    });
    expect(all.runs.find((r) => r.id === 'c-1')).toMatchObject({
      threadId: 'chief-channel',
      source: 'demo',
    });
    const pages: string[] = [];
    let cursor: string | null = null;
    do {
      const page: RunListPage = await getJson<RunListPage>(
        `${base}?limit=2${cursor === null ? '' : `&before=${cursor}`}`,
      );
      expect(page.runs.length).toBeLessThanOrEqual(2);
      pages.push(...page.runs.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(pages).toEqual(all.runs.map((r) => r.id));
    const problems = await getJson<RunListPage>(`${base}?problems=1`);
    expect(problems.runs.map((r) => r.id)).toEqual(['a-1', 'm-1', 'b-fail']);
    const mine = await getJson<RunListPage>(`${base}?thread=${H.threadId}`);
    expect(mine.runs.map((r) => r.id)).toEqual(['m-run', 'm-1']);
    for (const internal of ['chief-digest-x', 'chief-memory-x'])
      expect((await getJson<RunListPage>(`${base}?thread=${internal}`)).runs).toEqual([]);
    expect((await getJson<{ status: string }>(`/api/teams/${H.teamId}/runs/b-fail`)).status).toBe(
      'failed',
    );
    expect((await getJson<{ status: string }>(`/api/teams/${H.teamId}/runs/m-run`)).status).toBe(
      'running',
    );
    const head = await getJson<RunListPage>(`${base}?limit=3`);
    expect(head.runs.at(-1)?.id).toBe('a-1');
    H.s.db.delete(step).where(eq(step.id, 'a-1')).run();
    const rest = await getJson<RunListPage>(`${base}?limit=3&before=${head.nextCursor}`);
    expect(rest.runs.map((r) => r.id)).toEqual(['c-2', 'b-done', 'c-1']);
    await getJson(`${base}?before=a-1`, 400);
  });

  test('a team with no runs gets an empty first page', async () => {
    const empty = await getJson<RunListPage>(`/api/teams/${H.teamId}/runs`);
    expect(empty).toEqual({ runs: [], nextCursor: null });
  });
});
