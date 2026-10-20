// #1150 CI 磨绿环（server 轮询器，scheduler 家族）：失败方式先于实现固化
// （AGENTS.md 测试规则 3）。票面四条：
//   ① 扫描面打爆 rate limit → 批量扫描 + 条件请求（ETag），禁止逐 PR 全量拉；
//      429/读不到 = fail-open 不动，下轮重试
//   ② checks pending 被误判红 → 三态状态机：pending 不动 / 红修 / 绿推
//   ③ 修复步死循环 → 连续 N 轮（默认 3）仍红停手，标 failed 转人工
//   ④ build 已被人手动推进/关闭时轮询器不得回写 → 读当前 phase 再动
// 行为面（验收）：绿直接进 review 不派修复步；completeStep 对 PR 交付持
// building（磨绿前不进人工闸）；scheduler 接线（自循环，不进同步 tick 契约）。

import { createHash } from 'node:crypto';
import type { Phase } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { completeStep } from '../src/services/builds.js';
import {
  buildCiFixPrompt,
  CI_EMPTY_CHECKS_GRACE_MS,
  CI_FIX_PROMPT_HEAD,
  CI_FIX_ROUNDS_MAX,
  CI_POLL_INTERVAL_MS,
  type CiCheckFailure,
  createCiPoller,
} from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, type TestServer } from './helpers.js';

// ——— 测试世界 ————————————————————————————————————————————————————————————

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

/** check run 规格（mock 应答材料位；conclusion 缺省 null）。 */
export interface CheckSpec {
  name: string;
  status: string;
  conclusion?: string;
  summary?: string;
}

function res(status: number, etag: string, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

/** 由 build id 派生的 40 位 head SHA（多候选按它分派 check-runs 请求）。 */
function headShaFor(buildId: string): string {
  return createHash('sha1').update(buildId).digest('hex');
}

/** GitHub mock：check-runs 请求记进 requests（URL + 头），按状态回应；
 * if-none-match 命中 etag 且状态 200 → 304（真实 GitHub 的条件 GET 语义）。
 * #1403 起 ci-loop 先读 pulls/{n}（open PR，head = headSha）与 base 的必需
 * 检查名单（无分支保护、无规则集），这些请求记进 otherRequests。 */
class CheckRunsMock {
  requests: { url: string; headers: Record<string, string> }[] = [];
  otherRequests: string[] = [];

  constructor(
    private readonly state: {
      checks: CheckSpec[];
      etag?: string;
      /** 覆盖状态码（429 限流面 / 404 读不到面）。 */
      status?: number;
    },
    readonly headSha: string = 'a'.repeat(40),
    readonly prNumber: number | null = null,
  ) {}

  /** 多候选分派：本 PR 的 pulls 读与本 head 的 check-runs 读。 */
  owns(url: string): boolean {
    return (
      (this.prNumber !== null && url.endsWith(`/pulls/${this.prNumber}`)) ||
      url.includes(`/commits/${this.headSha}/`)
    );
  }

  readonly fetch = (input: string | URL, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    if (/\/pulls\/\d+$/.test(url)) {
      this.otherRequests.push(url);
      if ((init?.headers?.['if-none-match'] ?? '') === '"pull-etag"') {
        return Promise.resolve(res(304, '"pull-etag"', {}));
      }
      return Promise.resolve(
        res(200, '"pull-etag"', {
          state: 'open',
          merged: false,
          head: { sha: this.headSha },
          base: { ref: 'main' },
        }),
      );
    }
    if (url.endsWith('/rules/branches/main')) {
      this.otherRequests.push(url);
      return Promise.resolve(res(200, '"r"', []));
    }
    if (url.endsWith('/branches/main')) {
      this.otherRequests.push(url);
      return Promise.resolve(res(200, '"b"', { name: 'main', protected: false }));
    }
    this.requests.push({ url, headers: { ...(init?.headers ?? {}) } });
    const etag = this.state.etag ?? '"etag-1"';
    const status = this.state.status ?? 200;
    if (status === 200 && (init?.headers?.['if-none-match'] ?? '') === etag) {
      return Promise.resolve(res(304, etag, {}));
    }
    if (status !== 200) return Promise.resolve(res(status, etag, {}));
    return Promise.resolve(
      res(200, etag, {
        total_count: this.state.checks.length,
        check_runs: this.state.checks.map((c) => ({
          name: c.name,
          status: c.status,
          conclusion: c.conclusion ?? null,
          output: { title: null, summary: c.summary ?? null },
        })),
      }),
    );
  };
}

interface WorldOpts {
  /** todo 相位（缺省 building = 磨绿中）。 */
  phase?: Phase;
  prNumber?: number;
  /** 已完成的 CI 修复轮数（marker prompt 的 done 步）。 */
  fixRounds?: number;
  /** 在飞修复步（pending/claimed；修复步在跑时检查读的是旧 head）。 */
  activeFix?: 'pending' | 'claimed';
  checks?: CheckSpec[];
  etag?: string;
  status?: number;
}

interface PrWorld {
  s: TestServer;
  teamId: string;
  projectId: string;
  todoId: string;
  buildId: string;
  prNumber: number;
  base: number;
  mock: CheckRunsMock;
  /** 该世界上的轮询器（box 在位：token 阶梯走 connection 行）。 */
  poller: ReturnType<typeof createCiPoller>;
  todoRow(): { phase: string; hasChanges: boolean; v: number };
  buildRow(): { prNumber: number | null; errorMessage: string | null };
  fixRoundSteps(): { id: string; prompt: string | null; status: string }[];
  allSteps(): { id: string; kind: string; status: string; prompt: string | null }[];
}

function makePrWorld(opts: WorldOpts = {}): PrWorld {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const rnd = Math.random().toString(36).slice(2, 8);
  const base = Date.now();
  const teamId = s.team.id;
  const projectId = `proj-ci-${rnd}`;
  const todoId = `todo-ci-${rnd}`;
  const buildId = `build-ci-${rnd}`;
  const prNumber = opts.prNumber ?? 101;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${rnd}`,
      teamId,
      repoKind: 'github',
      githubRepo: 'octo/demo',
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId,
      projectId,
      title: 'ci loop target',
      spec: 'do it',
      phase: opts.phase ?? 'building',
      phaseAt: base,
      seqNum: 1,
      assignment: { plan: null, build: { agentId: `agent-ci-${rnd}` } },
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
      prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  // 原执行步（kind='build'，已 done——产 PR 的那一步；无 marker，不计修复轮）。
  s.db
    .insert(stepTable)
    .values({
      id: `step-orig-${rnd}`,
      buildId,
      kind: 'build',
      status: 'done',
      machineId: `machine-ci-${rnd}`,
      sessionId: `sess-${rnd}`,
      createdAt: base - 90_000,
    })
    .run();
  const failures: CiCheckFailure[] = [
    { name: 'lint', conclusion: 'failure', summary: 'biome 报 2 处 error' },
  ];
  for (let i = 0; i < (opts.fixRounds ?? 0); i++) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-fix-${rnd}-${i}`,
        buildId,
        kind: 'build',
        status: 'done',
        machineId: `machine-ci-${rnd}`,
        prompt: buildCiFixPrompt({
          prNumber,
          prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
          round: i + 1,
          failures,
        }),
        createdAt: base + i,
      })
      .run();
  }
  if (opts.activeFix !== undefined) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-live-${rnd}`,
        buildId,
        kind: 'build',
        status: opts.activeFix,
        ...(opts.activeFix === 'claimed'
          ? { machineId: `machine-ci-${rnd}`, claimedAt: base, lastHeartbeatAt: base }
          : {}),
        prompt: buildCiFixPrompt({
          prNumber,
          prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
          round: (opts.fixRounds ?? 0) + 1,
          failures,
        }),
        createdAt: base,
      })
      .run();
  }
  const mock = new CheckRunsMock(
    {
      checks: opts.checks ?? [],
      etag: opts.etag,
      status: opts.status,
    },
    headShaFor(buildId),
  );
  const poller = createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch: mock.fetch });
  return {
    s,
    teamId,
    projectId,
    todoId,
    buildId,
    prNumber,
    base,
    mock,
    poller,
    todoRow: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!,
    buildRow: () => s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!,
    fixRoundSteps: () =>
      s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .filter((r) => (r.prompt ?? '').startsWith(CI_FIX_PROMPT_HEAD)),
    allSteps: () => s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all(),
  };
}

/** 多候选世界（批量扫描面）：同一 server 上再种一棵 PR 树，各自配 mock。 */
function addCandidate(
  s: TestServer,
  checks: CheckSpec[],
  opts: { prNumber?: number; phase?: Phase } = {},
) {
  const rnd = Math.random().toString(36).slice(2, 8);
  const base = Date.now();
  const prNumber = opts.prNumber ?? 100 + Math.floor(Math.random() * 900);
  const projectId = `proj-ci-${rnd}`;
  const todoId = `todo-ci-${rnd}`;
  const buildId = `build-ci-${rnd}`;
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
      title: `t-${rnd}`,
      spec: '',
      phase: opts.phase ?? 'building',
      phaseAt: base,
      seqNum: 1,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base,
      prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  return {
    todoId,
    buildId,
    prNumber,
    mock: new CheckRunsMock({ checks }, headShaFor(buildId), prNumber),
  };
}

// ——— ① 扫描面纪律（批量 + ETag 条件请求 + 429 fail-open）———————————————————

describe('#1150 ① 扫描面纪律：批量扫描 + 条件请求（ETag）', () => {
  test('一轮 sweep = 一条 DB 扫描取全候选，每候选 1 个 pulls 条件 GET + 1 个 head SHA 的 check-runs GET（#1403；必需名单按仓缓存）', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    await w.poller.sweep();

    expect(w.mock.requests).toHaveLength(1);
    expect(w.mock.otherRequests).toEqual([
      `https://api.github.com/repos/octo/demo/pulls/${w.prNumber}`,
      'https://api.github.com/repos/octo/demo/branches/main',
      'https://api.github.com/repos/octo/demo/rules/branches/main',
    ]);
    const req = w.mock.requests[0];
    if (req === undefined) throw new Error('no request made');
    expect(req.url).toContain('https://api.github.com/repos/octo/demo/commits/');
    expect(req.url).toContain(`/commits/${w.mock.headSha}/check-runs`);
    expect(req.url).toContain('per_page=');
    // 未暖缓存的轮不带 if-none-match（首轮读一次，此后条件读）。
    expect(req.headers['if-none-match']).toBeUndefined();
    expect(req.headers.accept).toContain('vnd.github+json');
  });

  test('ETag 往返：首轮 200 存 etag，次轮携 if-none-match → 304 → 判据复用（不解析体）', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('review'); // 首轮 200 → 绿推闸
    // 人工把相位翻回 building（再扫一次同一株——模拟「下一轮还绿」）。
    w.s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, w.todoId)).run();

    await w.poller.sweep();

    expect(w.mock.requests).toHaveLength(2);
    const req2 = w.mock.requests[1];
    if (req2 === undefined) throw new Error('second sweep made no request');
    expect(req2.headers['if-none-match']).toBe('"etag-1"');
    // 304 → 缓存判据复用（绿）→ 又推闸。
    expect(w.todoRow().phase).toBe('review');
  });

  test('批量对账：3 候选一轮 = 3 个条件 GET，红绿 pending 三态各自落位 + 对账行落日志', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const red = addCandidate(s, [
      { name: 'lint', status: 'completed', conclusion: 'failure', summary: '2 errors' },
    ]);
    const green = addCandidate(s, [{ name: 'lint', status: 'completed', conclusion: 'success' }]);
    const pending = addCandidate(s, [{ name: 'e2e', status: 'in_progress' }]);
    const all = [red, green, pending];
    const info = vi.fn();
    const poller = createCiPoller(
      { ...s.svc, box: s.secretBox },
      {
        githubFetch: (input, init) => {
          const url = String(input);
          // 同仓同端点：pulls 按 PR 号、check-runs 按 head SHA 分派到各候选的
          // mock；必需名单（分支 / 规则集）是仓级读，交给任一 mock。
          for (const c of all) {
            if (c.mock.owns(url)) return c.mock.fetch(url, init);
          }
          if (url.includes('/branches/main')) return red.mock.fetch(url, init);
          throw new Error(`unexpected url ${url}`);
        },
        logger: { info },
      },
    );
    await poller.sweep();

    expect(red.mock.requests).toHaveLength(1);
    expect(green.mock.requests).toHaveLength(1);
    expect(pending.mock.requests).toHaveLength(1);
    // 红 → 追加 1 个 marker 修复步（相位留 building）。
    const redSteps = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, red.buildId))
      .all()
      .filter((r) => (r.prompt ?? '').startsWith(CI_FIX_PROMPT_HEAD));
    expect(redSteps).toHaveLength(1);
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, red.todoId)).get()!.phase).toBe(
      'building',
    );
    // 绿 → 推 review 闸；pending → 不动（v 不翻）。
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, green.todoId)).get()!.phase).toBe(
      'review',
    );
    const pendingTodo = s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, pending.todoId))
      .get()!;
    expect(pendingTodo.phase).toBe('building');
    expect(pendingTodo.v).toBe(1);
    // 对账行（每 sweep 一行）：候选数与三态落位。
    expect(info).toHaveBeenCalledTimes(1);
    const tally = info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(tally.candidates).toBe(3);
    expect(tally.appended).toBe(1);
    expect(tally.advanced).toBe(1);
    expect(tally.pending).toBe(1);
  });

  test('限流/读不到 = fail-open：不动任何行，下轮重试（无崩溃）', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
      status: 429,
    });
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('building');
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.todoRow().v).toBe(1);
  });

  test('token 阶梯：连接行在 → 条件 GET 带 Authorization 头（经既有 GitHub 连接读 checks）', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.teamId, login: 'octo', accessToken: 'token-plain', scope: 'repo' },
    );
    await w.poller.sweep();
    expect(w.mock.requests[0]?.headers.authorization).toBe('Bearer token-plain');
  });

  test('扫描面不含非候选：无 PR 的 build、非 building 相位、非 github 项目都不读 checks', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const noPr = addCandidate(s, []);
    s.db.update(buildTable).set({ prNumber: null }).where(eq(buildTable.id, noPr.buildId)).run();
    const review = addCandidate(s, []);
    s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, review.todoId)).run();
    const notGithub = addCandidate(s, []);
    s.db
      .update(projectTable)
      .set({ repoKind: 'local', githubRepo: null })
      .where(
        eq(
          projectTable.id,
          s.db.select().from(todoTable).where(eq(todoTable.id, notGithub.todoId)).get()!.projectId,
        ),
      )
      .run();
    const urls: string[] = [];
    const poller = createCiPoller(
      { ...s.svc },
      {
        githubFetch: (url) => {
          urls.push(String(url));
          return Promise.resolve(res(404, '"x"', {}));
        },
      },
    );
    await poller.sweep();
    // #1403：review 相位的 PR build 进对账面（只读 pulls/{n}），不进磨绿面。
    expect(urls.filter((u) => u.includes('/check-runs'))).toEqual([]);
    expect(urls).toEqual([expect.stringMatching(/\/pulls\/\d+$/)]);
  });
});

// ——— ② 三态：pending 不动 ——————————————————————————————————————————————

describe('#1150 ② checks pending 不误判红（三态状态机）', () => {
  test('在跑/排队 → 不动：无修复步、相位不动、无 errorMessage', async () => {
    const w = makePrWorld({ checks: [{ name: 'e2e', status: 'in_progress' }] });
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('building');
    expect(w.todoRow().v).toBe(1);
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.buildRow().errorMessage).toBeNull();
  });

  test('混合（1 个 failure 已完成 + 1 个 queued）→ 仍 pending：全部完成前不判红', async () => {
    const w = makePrWorld({
      checks: [
        { name: 'lint', status: 'completed', conclusion: 'failure' },
        { name: 'e2e', status: 'queued' },
      ],
    });
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('building');
    expect(w.fixRoundSteps()).toHaveLength(0);
  });

  test('空 checks（仓无 CI / 竞态）→ 宽限内 pending 不动；超宽限按绿推闸', async () => {
    const w = makePrWorld({ checks: [] });
    await w.poller.sweep(w.base);
    expect(w.todoRow().phase).toBe('building');
    await w.poller.sweep(w.base + CI_EMPTY_CHECKS_GRACE_MS - 1_000);
    expect(w.todoRow().phase).toBe('building');
    await w.poller.sweep(w.base + CI_EMPTY_CHECKS_GRACE_MS + 1_000);
    expect(w.todoRow().phase).toBe('review');
  });
});

// ——— ③ 死循环闸 ——————————————————————————————————————————————————————————

describe('#1150 ③ 修复步死循环闸（连续 N 轮仍红停手）', () => {
  test('红 → 追加修复步：prompt 带失败 check 名与日志摘要 + PR 号；修复步排队 pending', async () => {
    const w = makePrWorld({
      checks: [
        { name: 'lint', status: 'completed', conclusion: 'failure', summary: 'biome 2 errors' },
        { name: 'typecheck', status: 'completed', conclusion: 'timed_out' },
      ],
    });
    await w.poller.sweep();
    const rounds = w.fixRoundSteps();
    expect(rounds).toHaveLength(1);
    const prompt = rounds[0]?.prompt ?? '';
    expect(prompt).toContain(CI_FIX_PROMPT_HEAD);
    expect(prompt).toContain('lint');
    expect(prompt).toContain('biome 2 errors');
    expect(prompt).toContain('typecheck');
    expect(prompt).toContain(String(w.prNumber));
    expect(prompt).toContain('同一分支'); // 修复步只推同一分支（不新开、不合并）
    expect(rounds[0]?.status).toBe('pending');
    expect(w.todoRow().phase).toBe('building'); // 修复在飞：不进人工闸
  });

  test('修复步在飞 → 不叠派（幂等）：同轮再 sweep 不追加第二条', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    await w.poller.sweep();
    await w.poller.sweep();
    expect(w.fixRoundSteps()).toHaveLength(1);
  });

  test('N-1 轮完成仍红 → 追加第 N 轮；N 轮完成仍红 → 停手标 failed 转人工（不再叠派）', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
      fixRounds: CI_FIX_ROUNDS_MAX - 1,
    });
    await w.poller.sweep();
    expect(w.fixRoundSteps()).toHaveLength(CI_FIX_ROUNDS_MAX); // 边界：2 轮完成 → 仍派第 3 轮
    expect(w.todoRow().phase).toBe('building');
    expect(w.buildRow().errorMessage).toBeNull();

    // 第 3 轮跑完（marker 步置 done）仍红：计数已满 → 死循环闸。
    for (const r of w.fixRoundSteps()) {
      w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, r.id)).run();
    }
    await w.poller.sweep();
    expect(w.fixRoundSteps()).toHaveLength(CI_FIX_ROUNDS_MAX); // 不再叠派
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().errorMessage).toContain('连续');
    expect(w.buildRow().errorMessage).toContain('转人工');
    // 幂等：failed 相位退出扫描集，下一轮零请求零写。
    const before = w.mock.requests.length;
    await w.poller.sweep();
    expect(w.mock.requests.length).toBe(before);
  });

  test('计数判据 = marker prompt 的修复轮步（原执行步不计入）', () => {
    const w = makePrWorld({ checks: [], fixRounds: 2 });
    expect(w.allSteps()).toHaveLength(3); // 原始 1 + 修复轮 2
    expect(w.fixRoundSteps()).toHaveLength(2);
  });
});

// ——— ④ 已推进/关闭不回写 ——————————————————————————————————————————————

describe('#1150 ④ build 已被人手动推进/关闭时轮询器不回写（读当前 phase 再动）', () => {
  test('相位已 review（人工接管）→ 红也不派步不写', async () => {
    const w = makePrWorld({
      phase: 'review',
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    await w.poller.sweep();
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
  });

  test('相位已 closed / failed → 同样不动', async () => {
    const closed = makePrWorld({
      phase: 'closed',
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    await closed.poller.sweep();
    expect(closed.fixRoundSteps()).toHaveLength(0);
    expect(closed.todoRow().phase).toBe('closed');
    const failed = makePrWorld({
      phase: 'failed',
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    await failed.poller.sweep();
    expect(failed.fixRoundSteps()).toHaveLength(0);
    expect(failed.buildRow().errorMessage).toBeNull();
  });

  test('动作前重读相位：扫描快照与写面之间被人工推进 → 不写（网络窗内的竞态）', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    const inner = w.mock.fetch;
    // check-runs 应答落地瞬间，人工把相位推进 review（应答与写面之间的竞态窗）。
    const racing = (input: string | URL, init?: { headers?: Record<string, string> }) => {
      const p = inner(input, init);
      w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
      return p;
    };
    const poller2 = createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: racing });
    await poller2.sweep();
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.todoRow().phase).toBe('review'); // 人工推进不被覆盖
  });
});

// ——— 行为面：绿推闸 + 磨绿入口 + scheduler 接线 ————————————————————————————

describe('#1150 绿推闸 / completeStep 持 building / scheduler 接线', () => {
  test('绿 → 相位推进 review 闸（不派修复步）；hasChanges 承接不丢', async () => {
    const w = makePrWorld({
      checks: [
        { name: 'lint', status: 'completed', conclusion: 'success' },
        { name: 'e2e', status: 'completed', conclusion: 'success' },
      ],
    });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.todoRow().hasChanges).toBe(true);
  });

  test('green 后候选拿出磨绿集：再 sweep 不再读 checks（转 #1403 对账面）', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    await w.poller.sweep();
    const checksReads = () => w.mock.requests.filter((r) => r.url.includes('/check-runs')).length;
    const before = checksReads();
    await w.poller.sweep();
    expect(checksReads()).toBe(before);
  });

  test('completeStep：执行步成 + PR 交付（prNumber 在）→ 停在 building；无 PR → review（既有行为）', () => {
    const withPr = makePrWorld({ checks: [] });
    const stepId = `step-run-${Math.random().toString(36).slice(2, 8)}`;
    withPr.s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId: withPr.buildId,
        kind: 'build',
        status: 'claimed',
        machineId: `machine-ci-${stepId}`,
        createdAt: withPr.base,
      })
      .run();
    completeStep(withPr.s.svc, stepId, { hasChanges: true });
    expect(withPr.todoRow().phase).toBe('building'); // 磨绿入口：不进人工闸
    expect(withPr.todoRow().hasChanges).toBe(true);

    const noPr = makePrWorld({ checks: [] });
    noPr.s.db
      .update(buildTable)
      .set({ prNumber: null, prUrl: null })
      .where(eq(buildTable.id, noPr.buildId))
      .run();
    const stepId2 = `step-run2-${Math.random().toString(36).slice(2, 8)}`;
    noPr.s.db
      .insert(stepTable)
      .values({
        id: stepId2,
        buildId: noPr.buildId,
        kind: 'build',
        status: 'claimed',
        machineId: `machine-ci-${stepId2}`,
        createdAt: noPr.base,
      })
      .run();
    completeStep(noPr.s.svc, stepId2, { hasChanges: true });
    expect(noPr.todoRow().phase).toBe('review');

    // hosted/local + 直插 PR 字段（integration 的「已产 PR」模拟形态）：无
    // GitHub checks 可磨 → 不持 building，直进 review（既有行为）。
    const hosted = makePrWorld({ checks: [] });
    hosted.s.db
      .update(projectTable)
      .set({ repoKind: 'hosted', githubRepo: null, repoName: 'rework-lifecycle' })
      .where(eq(projectTable.id, hosted.projectId))
      .run();
    const stepId3 = `step-run3-${Math.random().toString(36).slice(2, 8)}`;
    hosted.s.db
      .insert(stepTable)
      .values({
        id: stepId3,
        buildId: hosted.buildId,
        kind: 'build',
        status: 'claimed',
        machineId: `machine-ci-${stepId3}`,
        createdAt: hosted.base,
      })
      .run();
    completeStep(hosted.s.svc, stepId3, { hasChanges: true });
    expect(hosted.todoRow().phase).toBe('review');
  });

  test('scheduler 接线：start() 启动即补扫 + 60s 自循环；stop() 停；tick() 不出站（同步契约）', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    const scheduler = createScheduler(w.s.svc, { tickMs: 15_000 }, undefined, {
      githubFetch: w.mock.fetch,
      logger: { info: () => {} },
    });
    // tick 是同步契约（shared Scheduler.tick: void）：网络读不进 tick。
    scheduler.tick();
    expect(w.mock.requests).toHaveLength(0);
    scheduler.start();
    // 补扫是异步网络面：等相位推进落位（请求 ≥ 1 随之成立）。
    await vi.waitFor(() => {
      expect(w.todoRow().phase).toBe('review');
    });
    expect(w.mock.requests.length).toBeGreaterThanOrEqual(1);
    scheduler.stop();
    expect(CI_POLL_INTERVAL_MS).toBe(60_000);
  });
});
