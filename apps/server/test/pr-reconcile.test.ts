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
// pr-gate 第一轮（#1414）补的失败方式：
//   ⑧ todo 的当前 build 没有 PR（#1217 守卫下不开新 PR / 探针失败），更旧
//      build 的 PR 已合并或已关闭 → 不得替当前 build 收尾或打回
//   ⑨ 两个 build 指向同一个 PR（#1217）→ 只按当前 build 读一次、写在它上面
//   ⑩ merge 步在飞（agent 正在合并）→ 对账不插手；先后两次收尾只落一条完成行
//   ⑪ 未连接 GitHub（匿名 60 次/小时）→ 每个候选 5 分钟内最多读一次
//   ⑫ 条件读 304 → 复用上轮状态；网络抛错 → 不动，下轮重读
//   ⑬ 合并行写明是谁合并的
// pr-gate 第二轮（#1414）补的：
//   ⑭ PR 合并之后同分支又推了提交（修复轮）→ 那个提交没进 main，不得收尾；
//      GitHub 的 update-branch 合并提交盖在 checkpoint 之上 → 仍算已合并
//   ⑮ 在飞步口径：waiting_quota 的 merge 步算在飞；没人领的 verify / review
//      步不挡对账（离线的 Verifier 不能让卡永远停在 review）
//   ⑯ 网络窗口里 todo 换了当前 build → 不写
//   ⑰ 错误状态码带着 PR 形的响应体 → 仍按读不到处理
// 合并 SHA 落 system 行；收尾复用 merge 步同一条 done 漏斗（完成行 + 拆卡波次）。

import type { Phase } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { finishTodoDone } from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
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
  mergedBy?: string;
  headSha?: string;
  /** compare/{checkpoint}...{head} 的 status（缺省 identical）；数字 = HTTP 错误码。 */
  compare?: string | number;
}

/** pulls/{n} 端点 mock：按 PR 号回应；compare 按 spec 回应；其它 URL
 * （check-runs）一律 404，证明 review 候选不走磨绿面。 */
class PullsMock {
  requests: string[] = [];
  headers: Record<string, string>[] = [];
  /** 下一次请求抛网络错（undici 的 TypeError 形）。 */
  throwNext = false;
  constructor(
    readonly pulls: Record<number, PullSpec>,
    private readonly status = 200,
  ) {}

  readonly fetch = (input: string | URL, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    this.requests.push(url);
    this.headers.push({ ...(init?.headers ?? {}) });
    if (this.throwNext) {
      this.throwNext = false;
      return Promise.reject(new TypeError('fetch failed'));
    }
    if ((init?.headers?.['if-none-match'] ?? '') === '"x"') {
      return Promise.resolve(res(304, '"x"', {}));
    }
    const cmp = url.match(/\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/);
    if (cmp !== null) {
      const spec = Object.values(this.pulls).find((p) => (p.headSha ?? 'f'.repeat(40)) === cmp[2]);
      const status = spec?.compare ?? 'identical';
      if (typeof status === 'number') return Promise.resolve(res(status, '"c"', {}));
      return Promise.resolve(res(200, '"c"', { status }));
    }
    const m = url.match(/\/pulls\/(\d+)$/);
    if (m === null) return Promise.resolve(res(404, '"x"', {}));
    const spec = this.pulls[Number(m[1])];
    if (spec === undefined) return Promise.resolve(res(404, '"x"', {}));
    // error statuses still carry a PR-shaped body: the status code alone must decide
    return Promise.resolve(
      res(this.status, '"x"', {
        number: Number(m[1]),
        state: spec.state,
        merged: spec.merged,
        merge_commit_sha: spec.mergeCommitSha ?? null,
        merged_by: spec.mergedBy === undefined ? null : { login: spec.mergedBy },
        head: { sha: spec.headSha ?? 'f'.repeat(40) },
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

function makeWorld(
  opts: {
    phase?: Phase;
    prNumber?: number;
    olderClosedPr?: number;
    /** a newer build of the same todo becomes todo.latestBuildId (null = no PR). */
    newerBuildPr?: number | null;
    /** a step of the PR build still in flight (the merge step by default). */
    inflight?: 'pending' | 'claimed' | 'waiting_quota';
    inflightKind?: 'merge' | 'verify' | 'review';
    /** the build step's checkpointCommit (branch HEAD at step end). */
    checkpoint?: string;
    /** GitHub connected (token present); default anonymous. */
    connected?: boolean;
  } = {},
): World {
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
  let latestBuildId = buildId;
  if (opts.newerBuildPr !== undefined) {
    latestBuildId = `build-new-${rnd}`;
    s.db
      .insert(buildTable)
      .values({
        id: latestBuildId,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: base - 1_000,
        prUrl:
          opts.newerBuildPr === null
            ? null
            : `https://github.com/octo/demo/pull/${opts.newerBuildPr}`,
        prNumber: opts.newerBuildPr,
      })
      .run();
  }
  s.db.update(todoTable).set({ latestBuildId }).where(eq(todoTable.id, todoId)).run();
  if (opts.inflight !== undefined) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-merge-${rnd}`,
        buildId,
        kind: opts.inflightKind ?? 'merge',
        status: opts.inflight,
        createdAt: base,
      })
      .run();
  }
  if (opts.checkpoint !== undefined) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-build-${rnd}`,
        buildId,
        kind: 'build',
        status: 'done',
        checkpointCommit: opts.checkpoint,
        createdAt: base - 30_000,
      })
      .run();
  }
  if (opts.connected === true) {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'gho_test', scope: 'read:user repo' },
    );
  }
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

  test("⑧a the todo's current build has no PR; an older build's PR merged → nothing changes", async () => {
    const w = makeWorld({ newerBuildPr: null });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests).toEqual([]);
  });

  test("⑧b the todo's current build has no PR; an older build's PR closed → not failed", async () => {
    const w = makeWorld({ newerBuildPr: null });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
  });

  test('⑨ two builds point at the same PR (#1217) → one read, written on the current build', async () => {
    const w = makeWorld({ newerBuildPr: 201 });
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    await pollerFor(w, mock).sweep();
    expect(mock.requests.filter((u) => u.endsWith('/pulls/201'))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('done');
    expect(w.systemRows()).toEqual([]); // the older build's conversation is untouched
  });

  test('⑩a a merge step in flight → reconcile does not step in', async () => {
    const w = makeWorld({ inflight: 'claimed' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests).toEqual([]);
  });

  test('⑩b finishing twice leaves one completion row', () => {
    const w = makeWorld();
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.systemRows().filter((c) => c.includes('任务已完成'))).toHaveLength(1);
  });

  test('⑪ anonymous: a candidate is read at most once per five minutes', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(mock.requests).toHaveLength(1);
    await poller.sweep(t0 + 300_001);
    expect(mock.requests).toHaveLength(2);
  });

  test('⑫a connected: the second read is conditional and a 304 changes nothing', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep();
    expect(mock.requests).toHaveLength(2);
    expect(mock.headers[1]?.['if-none-match']).toBe('"x"');
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑫b a thrown network error → nothing changes; the next sweep reads again', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    mock.throwNext = true;
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
  });

  test('⑬ the merge row names who merged', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        mergedBy: 'octocat',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.systemRows().some((c) => c.includes('abc1234') && c.includes('octocat'))).toBe(true);
  });

  test('⑭a merged, but the branch has a later commit the merge does not contain → stays in review with a hint', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        compare: 'diverged',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().some((c) => c.includes('aaaaaaa') && c.includes(`#${w.prNumber}`))).toBe(
      true,
    );
  });

  test('⑭b merged at a head built on top of the checkpoint (update-branch) → done', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234', compare: 'ahead' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
  });

  test('⑭c the checkpoint commit is unknown to GitHub (never pushed) → stays in review with a hint', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 404 },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
  });

  test('⑮a a merge step waiting for quota counts as in flight', async () => {
    const w = makeWorld({ inflight: 'waiting_quota' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
  });

  test.each(['verify', 'review'] as const)(
    '⑮b an unclaimed %s step does not hold the reconcile',
    async (inflightKind) => {
      const w = makeWorld({ inflight: 'pending', inflightKind });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('done');
    },
  );

  test('⑯ the todo gets a new current build during the network window → no write', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const racing = (input: string | URL, init?: { headers?: Record<string, string> }) => {
      w.s.db
        .update(todoTable)
        .set({ latestBuildId: 'build-elsewhere' })
        .where(eq(todoTable.id, w.todoId))
        .run();
      return mock.fetch(input, init);
    };
    await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: racing }).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('building-phase builds stay with the CI grind path (no pulls read for them)', async () => {
    const w = makeWorld({ phase: 'building' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(mock.requests.some((u) => u.includes('/pulls/'))).toBe(false);
  });
});
