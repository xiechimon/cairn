// #1403 PR 对账（ci-loop 第二候选集）：review 关口上的 GitHub 形态 build，PR
// 在 GitHub 上的终态回写 pacman。失败方式先于实现固化（AGENTS.md 测试规则）：
//   ① PR 已在 GitHub 合并（不论谁合的）→ todo 停在 review 永不收尾
//   ② PR 关闭未合并 → todo 仍挂 review，看不出这张 PR 已经没了
//   ③ PR 仍 open → 对账不得改任何东西
//   ④ 读不到（限流/404/网络）→ 不得据此推进或打回（fail-open，下轮重试）
//   ⑤ 网络窗口内人工改了相位 → 对账不得回写
//   ⑥ 同一 todo 更旧的 PR build 已关闭（spec 23 被取代分支）而最新 PR 仍 open
//      → 不得把 todo 打成 failed
//   ⑦ 已 done 之后再扫 → 不再是候选，不重复收尾
// 合并 SHA 落 system 行；收尾复用 merge 步同一条 done 漏斗（🎉 行 + 拆卡波次）。

import type { Phase } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  project as projectTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

function res(status: number, etag: string, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

interface PullSpec {
  state: 'open' | 'closed';
  merged: boolean;
  mergeCommitSha?: string | null;
}

/** pulls/{n} 端点 mock：按 PR 号回应；其它 URL（check-runs）一律 404，
 * 证明 review 候选不走磨绿面。 */
class PullsMock {
  requests: string[] = [];
  constructor(
    private readonly pulls: Record<number, PullSpec>,
    private readonly status = 200,
  ) {}

  readonly fetch = (input: string | URL) => {
    const url = String(input);
    this.requests.push(url);
    const m = url.match(/\/pulls\/(\d+)$/);
    if (m === null) return Promise.resolve(res(404, '"x"', {}));
    if (this.status !== 200) return Promise.resolve(res(this.status, '"x"', {}));
    const spec = this.pulls[Number(m[1])];
    if (spec === undefined) return Promise.resolve(res(404, '"x"', {}));
    return Promise.resolve(
      res(200, '"x"', {
        number: Number(m[1]),
        state: spec.state,
        merged: spec.merged,
        merge_commit_sha: spec.mergeCommitSha ?? null,
        head: { sha: 'f'.repeat(40) },
      }),
    );
  };
}

interface World {
  s: TestServer;
  todoId: string;
  buildId: string;
  prNumber: number;
  todoRow(): { phase: string };
  buildRow(): { errorMessage: string | null };
  systemRows(): string[];
}

function makeWorld(opts: { phase?: Phase; prNumber?: number; olderClosedPr?: number } = {}): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const rnd = Math.random().toString(36).slice(2, 8);
  const base = Date.now();
  const projectId = `proj-rec-${rnd}`;
  const todoId = `todo-rec-${rnd}`;
  const buildId = `build-rec-${rnd}`;
  const prNumber = opts.prNumber ?? 201;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${rnd}`,
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: 'octo/demo',
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'reconcile target',
      spec: 'do it',
      phase: opts.phase ?? 'review',
      phaseAt: base,
      seqNum: 1,
      assignment: { plan: null, build: { agentId: `agent-rec-${rnd}` } },
    })
    .run();
  if (opts.olderClosedPr !== undefined) {
    s.db
      .insert(buildTable)
      .values({
        id: `build-old-${rnd}`,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: base - 600_000,
        prUrl: `https://github.com/octo/demo/pull/${opts.olderClosedPr}`,
        prNumber: opts.olderClosedPr,
      })
      .run();
  }
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - 60_000,
      prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  return {
    s,
    todoId,
    buildId,
    prNumber,
    todoRow: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!,
    buildRow: () => s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!,
    systemRows: () =>
      s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .filter((r) => r.role === 'system')
        .map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))),
  };
}

function pollerFor(w: World, mock: PullsMock) {
  return createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: mock.fetch });
}

describe('#1403 PR reconcile for review-phase builds', () => {
  test('① merged on GitHub → todo done, merge sha in a system row, celebration row', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234def5678' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    const rows = w.systemRows();
    expect(rows.some((c) => c.includes(`#${w.prNumber}`) && c.includes('abc1234'))).toBe(true);
    expect(rows).toContain('🎉 任务已完成');
    expect(mock.requests.some((u) => u.endsWith(`/repos/octo/demo/pulls/${w.prNumber}`))).toBe(
      true,
    );
  });

  test('② closed without merge → todo failed with the cause on the build', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().errorMessage ?? '').toContain(`#${w.prNumber}`);
  });

  test('③ still open → nothing changes', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.systemRows()).toEqual([]);
  });

  test.each([429, 404, 502])('④ unreadable (%i) → nothing changes', async (status) => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } }, status);
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑤ phase moved by a person during the network window → no write', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const racing = (input: string | URL) => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
      return mock.fetch(input);
    };
    await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: racing }).sweep();
    expect(w.todoRow().phase).toBe('closed');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑥ an older PR build of the same todo is closed, the latest PR is open → nothing changes', async () => {
    const w = makeWorld({ olderClosedPr: 150 });
    const mock = new PullsMock({
      150: { state: 'closed', merged: false },
      [w.prNumber]: { state: 'open', merged: false },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests.some((u) => u.endsWith('/pulls/150'))).toBe(false);
  });

  test('⑦ after done, a second sweep does not touch the todo again', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    const requestsAfterFirst = mock.requests.length;
    const rowsAfterFirst = w.systemRows().length;
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(mock.requests.length).toBe(requestsAfterFirst);
    expect(w.systemRows().length).toBe(rowsAfterFirst);
  });

  test('building-phase builds are reconciled on the CI grind path too (#1403 segment 3)', async () => {
    const w = makeWorld({ phase: 'building' });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(mock.requests.some((u) => u.includes('/check-runs'))).toBe(false);
  });
});
