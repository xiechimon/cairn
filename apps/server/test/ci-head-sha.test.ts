// #1403 segment 3: the CI grind reads the PR first, judges checks at the PR's
// head SHA against the base branch's required checks, and the review gate
// reports BEHIND / DIRTY. Failure modes, fixed before the implementation:
//   ① checks are read by branch ref, so the verdict is not bound to a commit
//   ② a failing check that is not required sends the agent on a fix round
//   ③ a cancelled required check counts as green
//   ④ neutral / skipped required checks must stay green (GitHub's own rule)
//   ⑤ a required check that never reports, while others completed, counts as
//      green at once (grace like the empty-checks case instead)
//   ⑥ the required list is unreadable → fall back to every check, not to none
//   ⑦ ruleset required checks are ignored (only classic protection read)
//   ⑧ PR merged or closed on GitHub while the todo is still building is missed
//   ⑨ review: BEHIND gives no hint, or a hint on every sweep
//   ⑩ review: DIRTY gives no hint, or starts a round (review→building is not a
//      phase edge; resolving conflicts automatically waits for that decision)
//   ⑪ review: clean / unknown mergeability writes nothing
//   ⑫ the required list is read on every sweep instead of cached

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
import { CI_EMPTY_CHECKS_GRACE_MS, createCiPoller } from '../src/services/ci-loop.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const HEAD = 'c'.repeat(40);

function res(status: number, body: unknown, etag = '"e"') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

interface Check {
  name: string;
  status?: string;
  conclusion?: string | null;
}

interface GithubState {
  pull?: {
    state?: 'open' | 'closed';
    merged?: boolean;
    mergeCommitSha?: string | null;
    mergeableState?: string;
  };
  /** classic protection on main: contexts, or an HTTP status for the branch read. */
  protection?: string[] | number;
  /** ruleset required checks on main, or an HTTP status for the rules read. */
  rules?: string[] | number;
  checks?: Check[];
}

class GithubMock {
  urls: string[] = [];
  constructor(readonly state: GithubState) {}

  readonly fetch = (input: string | URL) => {
    const url = String(input);
    this.urls.push(url);
    const st = this.state;
    if (/\/pulls\/\d+$/.test(url)) {
      const p = st.pull ?? {};
      return Promise.resolve(
        res(200, {
          number: 301,
          title: 'Fix the thing',
          state: p.state ?? 'open',
          merged: p.merged ?? false,
          merge_commit_sha: p.mergeCommitSha ?? null,
          mergeable_state: p.mergeableState ?? 'clean',
          head: { sha: HEAD, ref: 'pacman/conv' },
          base: { ref: 'main' },
        }),
      );
    }
    if (url.endsWith('/repos/octo/demo/branches/main')) {
      const pr = st.protection ?? [];
      if (typeof pr === 'number') return Promise.resolve(res(pr, {}));
      return Promise.resolve(
        res(200, {
          name: 'main',
          protected: pr.length > 0,
          protection: {
            enabled: pr.length > 0,
            required_status_checks: { contexts: pr, checks: pr.map((c) => ({ context: c })) },
          },
        }),
      );
    }
    if (url.endsWith('/rules/branches/main')) {
      const rules = st.rules ?? [];
      if (typeof rules === 'number') return Promise.resolve(res(rules, {}));
      return Promise.resolve(
        res(
          200,
          rules.length === 0
            ? []
            : [
                {
                  type: 'required_status_checks',
                  parameters: {
                    strict_required_status_checks_policy: true,
                    required_status_checks: rules.map((context) => ({ context })),
                  },
                },
              ],
        ),
      );
    }
    if (url.includes('/check-runs')) {
      return Promise.resolve(
        res(200, {
          check_runs: (st.checks ?? []).map((c) => ({
            name: c.name,
            status: c.status ?? 'completed',
            conclusion: c.conclusion === undefined ? 'success' : c.conclusion,
            output: { title: null, summary: null },
          })),
        }),
      );
    }
    return Promise.resolve(res(404, { message: 'Not Found' }));
  };
}

interface World {
  s: TestServer;
  todoId: string;
  buildId: string;
  mock: GithubMock;
  poller: ReturnType<typeof createCiPoller>;
  phase(): string;
  systemRows(): string[];
  steps(): { kind: string; prompt: string | null }[];
}

function makeWorld(state: GithubState, opts: { phase?: Phase } = {}): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const rnd = Math.random().toString(36).slice(2, 8);
  const projectId = `proj-hs-${rnd}`;
  const todoId = `todo-hs-${rnd}`;
  const buildId = `build-hs-${rnd}`;
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
      title: 'head sha target',
      spec: 'do it',
      phase: opts.phase ?? 'building',
      phaseAt: Date.now(),
      seqNum: 1,
      assignment: { plan: null, build: { agentId: `agent-hs-${rnd}` } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: Date.now() - 60_000,
      prUrl: 'https://github.com/octo/demo/pull/301',
      prNumber: 301,
    })
    .run();
  const mock = new GithubMock(state);
  return {
    s,
    todoId,
    buildId,
    mock,
    poller: createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch: mock.fetch }),
    phase: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!.phase,
    systemRows: () =>
      s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .filter((r) => r.role === 'system')
        .map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))),
    steps: () =>
      s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .map((r) => ({ kind: r.kind, prompt: r.prompt })),
  };
}

const fixRounds = (w: World) => w.steps().filter((x) => x.prompt?.startsWith('[ci-fix]'));

describe('#1403 CI grind at the PR head SHA with required checks', () => {
  test('① check-runs are read at the PR head SHA, not the branch', async () => {
    const w = makeWorld({ checks: [{ name: 'check' }] });
    await w.poller.sweep();
    const checkReads = w.mock.urls.filter((u) => u.includes('/check-runs'));
    expect(checkReads).toHaveLength(1);
    expect(checkReads[0]).toContain(`/commits/${HEAD}/check-runs`);
    expect(w.phase()).toBe('review');
  });

  test('② a failing check that is not required does not start a fix round', async () => {
    const w = makeWorld({
      protection: ['check', 'e2e-gate'],
      checks: [
        { name: 'check' },
        { name: 'e2e-gate' },
        { name: 'Cursor Bugbot', conclusion: 'failure' },
      ],
    });
    await w.poller.sweep();
    expect(fixRounds(w)).toHaveLength(0);
    expect(w.phase()).toBe('review');
  });

  test('③ a cancelled required check is red', async () => {
    const w = makeWorld({
      protection: ['check'],
      checks: [{ name: 'check', conclusion: 'cancelled' }],
    });
    await w.poller.sweep();
    expect(w.phase()).toBe('building');
    expect(fixRounds(w)).toHaveLength(1);
    expect(fixRounds(w)[0]?.prompt).toContain('check（cancelled）');
  });

  test.each(['neutral', 'skipped'])('④ a %s required check is green', async (conclusion) => {
    const w = makeWorld({ protection: ['check'], checks: [{ name: 'check', conclusion }] });
    await w.poller.sweep();
    expect(w.phase()).toBe('review');
  });

  test('⑤ a required check that has not reported waits for the grace, then hands over', async () => {
    const w = makeWorld({
      protection: ['check', 'e2e-gate'],
      checks: [{ name: 'check' }],
    });
    const t0 = Date.now();
    await w.poller.sweep(t0);
    expect(w.phase()).toBe('building');
    await w.poller.sweep(t0 + CI_EMPTY_CHECKS_GRACE_MS + 1);
    expect(w.phase()).toBe('review');
    expect(fixRounds(w)).toHaveLength(0);
  });

  test('⑥ an unreadable required list falls back to every check', async () => {
    const w = makeWorld({
      protection: 500,
      checks: [{ name: 'check' }, { name: 'extra', conclusion: 'failure' }],
    });
    await w.poller.sweep();
    expect(w.phase()).toBe('building');
    expect(fixRounds(w)).toHaveLength(1);
  });

  test('⑦ ruleset required checks count', async () => {
    const w = makeWorld({
      rules: ['ruleset-check'],
      checks: [
        { name: 'check' },
        { name: 'ruleset-check', conclusion: 'failure' },
        { name: 'extra', conclusion: 'failure' },
      ],
    });
    await w.poller.sweep();
    expect(fixRounds(w)).toHaveLength(1);
    expect(fixRounds(w)[0]?.prompt).toContain('ruleset-check');
    expect(fixRounds(w)[0]?.prompt).not.toContain('extra');
  });

  test('⑧a PR merged on GitHub while building → done with the merge sha', async () => {
    const w = makeWorld({
      pull: { state: 'closed', merged: true, mergeCommitSha: 'abc1234def' },
      checks: [{ name: 'check', status: 'in_progress', conclusion: null }],
    });
    await w.poller.sweep();
    expect(w.phase()).toBe('done');
    expect(w.systemRows().some((c) => c.includes('#301') && c.includes('abc1234'))).toBe(true);
  });

  test('⑧b PR closed without merge while building → failed', async () => {
    const w = makeWorld({ pull: { state: 'closed', merged: false } });
    await w.poller.sweep();
    expect(w.phase()).toBe('failed');
  });

  test('⑫ the required list is read once across sweeps', async () => {
    const w = makeWorld({
      protection: ['check'],
      checks: [{ name: 'check', status: 'in_progress', conclusion: null }],
    });
    const t0 = Date.now();
    await w.poller.sweep(t0);
    await w.poller.sweep(t0 + 60_000);
    expect(w.mock.urls.filter((u) => u.endsWith('/repos/octo/demo/branches/main'))).toHaveLength(1);
    expect(w.mock.urls.filter((u) => u.endsWith('/rules/branches/main'))).toHaveLength(1);
    expect(w.mock.urls.filter((u) => u.includes('/check-runs'))).toHaveLength(2);
  });
});

describe('#1403 review gate reports BEHIND and DIRTY', () => {
  test('⑨ BEHIND → one hint naming update-branch, not repeated on the next sweep', async () => {
    const w = makeWorld({ pull: { mergeableState: 'behind' } }, { phase: 'review' });
    await w.poller.sweep();
    await w.poller.sweep();
    const hints = w.systemRows().filter((c) => c.includes('#301') && c.includes('落后'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain(HEAD.slice(0, 7));
    expect(w.phase()).toBe('review');
    expect(w.mock.urls.some((u) => u.includes('update-branch'))).toBe(false);
  });

  test('⑩ DIRTY → one hint naming the conflict; no step, phase stays review', async () => {
    const w = makeWorld({ pull: { mergeableState: 'dirty' } }, { phase: 'review' });
    await w.poller.sweep();
    await w.poller.sweep();
    expect(w.systemRows().filter((c) => c.includes('#301') && c.includes('冲突'))).toHaveLength(1);
    expect(w.steps()).toHaveLength(0);
    expect(w.phase()).toBe('review');
  });

  test.each(['clean', 'unknown', 'blocked', 'unstable'])(
    '⑪ %s → nothing written',
    async (mergeableState) => {
      const w = makeWorld({ pull: { mergeableState } }, { phase: 'review' });
      await w.poller.sweep();
      expect(w.systemRows()).toEqual([]);
      expect(w.phase()).toBe('review');
    },
  );
});
