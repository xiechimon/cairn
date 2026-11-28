import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { buildCiFixPrompt, createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { retryLessonsOf } from '../src/services/retry-lessons.js';
import { bootServer, insertMachine, type TestServer } from './helpers.js';

const CI_FIX_GREEN_EVENT = '[correction:ci-fix-green] CI 修复后转绿，待归因。';
const REPO = 'octo/demo';

interface Call {
  method: string;
  url: string;
}

function response(status: number, etag: string, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

function headOf(prNumber: number): string {
  return prNumber.toString(16).padStart(8, '0').repeat(5);
}

function greenChecks(calls: Call[]): FetchLike {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    const pull = /\/pulls\/(\d+)$/.exec(new URL(url).pathname);
    if (pull !== null) {
      const prNumber = Number(pull[1]);
      return response(200, '"pr"', {
        number: prNumber,
        state: 'open',
        merged: false,
        mergeable_state: 'clean',
        head: { sha: headOf(prNumber), ref: conversationBranch(buildId), repo: { id: 1 } },
        base: { ref: 'main', repo: { id: 1, default_branch: 'main' } },
      });
    }
    if (url.includes('/pulls?')) return response(200, '"list"', []);
    if (url.includes('/issues?state=open&labels=autonomy-paused')) return response(200, '"m"', []);
    if (/\/rules\/branches\//.test(url)) return response(200, '"rules"', []);
    if (/\/branches\/[^/?]+$/.test(url)) return response(200, '"branch"', { name: 'main' });
    return response(200, '"checks"', {
      total_count: 1,
      check_runs: [
        {
          name: 'lint',
          status: 'completed',
          conclusion: 'success',
          completed_at: null,
          output: { title: null, summary: null },
        },
      ],
    });
  };
}

let buildId = '';
let todoId = '';

function world(): {
  s: TestServer;
  calls: Call[];
  fetch: FetchLike;
  poller: ReturnType<typeof createCiPoller>;
} {
  const s = bootServer();
  insertMachine(s);
  const base = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  const projectId = `proj-ci-retired-${suffix}`;
  todoId = `todo-ci-retired-${suffix}`;
  buildId = `build-ci-retired-${suffix}`;
  const prNumber = 101;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${suffix}`,
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: REPO,
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'ci loop target',
      spec: 'do it',
      phase: 'building',
      phaseAt: base,
      seqNum: 1,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - 60_000,
      prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
      prNumber,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: `step-orig-${suffix}`,
      buildId,
      kind: 'build',
      status: 'done',
      machineId: `machine-ci-${suffix}`,
      sessionId: `sess-${suffix}`,
      createdAt: base - 90_000,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: `step-fix-${suffix}`,
      buildId,
      kind: 'build',
      status: 'done',
      machineId: `machine-ci-${suffix}`,
      prompt: buildCiFixPrompt({
        prNumber,
        prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
        round: 1,
        failures: [{ name: 'lint', conclusion: 'failure', summary: 'biome 报 2 处 error' }],
      }),
      createdAt: base,
    })
    .run();
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: 'token-plain', scope: 'repo' },
  );
  const calls: Call[] = [];
  const fetch = greenChecks(calls);
  const poller = createCiPoller(
    { ...s.svc, box: s.secretBox, githubFetch: fetch },
    { githubFetch: fetch },
  );
  return { s, calls, fetch, poller };
}

describe('a ci-fix leg that turns green records the lesson event and opens no issue', () => {
  test('the [correction:ci-fix-green] event is written, retry lessons read it, and no GitHub issue is opened or listed', async () => {
    const w = world();
    await w.poller.sweep();

    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.phase).toBe(
      'done',
    );
    const events = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all()
      .filter((row) => row.role === 'system' && row.content === CI_FIX_GREEN_EVENT);
    expect(events).toHaveLength(1);
    expect(retryLessonsOf(w.s.db, buildId) ?? '').not.toContain('最后一轮 CI 失败的检查');

    const issueCalls = w.calls.filter((call) => {
      const url = new URL(call.url);
      if (!/\/issues/.test(url.pathname)) return false;
      return !call.url.includes('labels=autonomy-paused');
    });
    expect(issueCalls).toEqual([]);
    w.s.dispose();
  });
});
