import { afterEach, expect, test, vi } from 'vitest';
import { autonomousMergeAdmission, autonomyPause, build, project, todo } from '../src/db/schema.js';
import { claimAutonomousMerge } from '../src/services/autonomous-merge.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { readGithubAutonomyPause } from '../src/services/github-autonomy-brake.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { stubGithubApp } from './github-identity-fixture.js';
import { bootServer, req, teamPausedForTest } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const RED = 'a'.repeat(40);
const GREEN = 'c'.repeat(40);
const RED_AGAIN = 'd'.repeat(40);

type Conclusion = 'success' | 'failure' | 'pending';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function world() {
  const heads = new Map<string, string>([
    ['octo/alpha', RED],
    ['octo/beta', GREEN],
  ]);
  const checks = new Map<string, Conclusion>([
    [RED, 'failure'],
    [GREEN, 'success'],
    [RED_AGAIN, 'failure'],
  ]);
  const issues = new Map<string, { open: boolean; comments: string[]; nodeId?: string }>();
  const attempts = new Map<string, number>();
  const attemptChecks = new Map<string, Conclusion>([
    [`${RED}:1`, 'failure'],
    [`${GREEN}:1`, 'success'],
    [`${RED_AGAIN}:1`, 'failure'],
  ]);
  const workflowIds = new Map<string, number>();
  const branches = new Map<string, string>();
  const unavailableChecks = new Set<string>();
  const failedPublications = new Set<string>();
  let afterCheckRead: (() => void) | undefined;
  let beforeClose: (() => Promise<void>) | undefined;
  let beforePublication: (() => Promise<void>) | undefined;
  let foreignGreen = false;
  let next = 1;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const parts = url.pathname.split('/');
    const repo = parts.slice(2, 4).join('/');
    const rest = parts.slice(4);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const branch = branches.get(repo) ?? 'main';
    if (rest.length === 0) return Response.json({ default_branch: branch });
    if (rest[0] === 'branches')
      return Response.json({
        commit: { sha: decodeURIComponent(rest[1] ?? '') === branch ? heads.get(repo) : GREEN },
      });
    if (rest[0] === 'actions' && rest.at(-1) === 'runs') {
      if (unavailableChecks.has(repo)) return new Response('', { status: 503 });
      const sha = url.searchParams.get('head_sha');
      const workflowId = workflowIds.get(repo) ?? 10;
      const wanted = rest[1] === 'workflows' ? rest[2] : undefined;
      if (
        wanted !== undefined &&
        (wanted === 'ci.yml' ? workflowId !== 10 : wanted !== String(workflowId))
      )
        return Response.json({ workflow_runs: [] });
      if (url.searchParams.get('branch') !== branch || sha === null || !checks.has(sha))
        return Response.json({ workflow_runs: [] });
      return Response.json({
        workflow_runs: [
          {
            id: sha.charCodeAt(0),
            workflow_id: workflowId,
            run_attempt: attempts.get(sha) ?? 1,
            head_sha: sha,
            head_branch: branch,
            event: 'push',
          },
        ],
      });
    }
    if (rest[0] === 'actions' && rest.at(-1) === 'jobs') {
      const sha = String.fromCharCode(Number(rest[2])).repeat(40);
      const state = attemptChecks.get(`${sha}:${rest[4]}`) ?? 'pending';
      afterCheckRead?.();
      return Response.json({
        jobs: [
          {
            name: 'check',
            status: state === 'pending' ? 'in_progress' : 'completed',
            conclusion: state === 'pending' ? null : state,
          },
        ],
      });
    }
    if (rest[0] === 'commits' && rest[2] === 'check-runs') {
      const state = checks.get(rest[1] ?? '') ?? 'pending';
      afterCheckRead?.();
      return Response.json({
        check_runs: [
          {
            id: 1,
            name: 'check',
            status: state === 'pending' ? 'in_progress' : 'completed',
            conclusion: state === 'pending' ? null : state,
            app: { slug: 'github-actions' },
          },
          ...(foreignGreen
            ? [
                {
                  id: 2,
                  name: 'check',
                  status: 'completed',
                  conclusion: 'success',
                  app: { slug: 'github-actions' },
                },
              ]
            : []),
        ],
      });
    }
    if (rest[0] === 'issues' && rest.length === 1 && method === 'POST') {
      await beforePublication?.();
      if (failedPublications.has(repo)) return new Response('', { status: 403 });
      const number = next++;
      const nodeId = `marker-${number}`;
      issues.set(`${repo}#${number}`, { open: true, comments: [], nodeId });
      return Response.json({ number, node_id: nodeId });
    }
    if (rest[0] === 'issues' && rest.length === 1)
      return Response.json(
        [...issues.entries()]
          .filter(([key, issue]) => key.startsWith(`${repo}#`) && issue.open)
          .map(([key, issue]) => ({ number: Number(key.split('#')[1]), node_id: issue.nodeId })),
      );
    if (rest[0] === 'issues' && rest[1] !== undefined) {
      const issue = issues.get(`${repo}#${rest[1]}`);
      if (issue === undefined) return new Response('', { status: 404 });
      if (rest[2] === 'comments' && method === 'POST') issue.comments.push(String(body.body));
      if (rest[2] === undefined && method === 'PATCH' && body.state === 'closed') {
        await beforeClose?.();
        issue.open = false;
      }
      return Response.json({ state: issue.open ? 'open' : 'closed', node_id: issue.nodeId });
    }
    if (rest[0] === 'labels') return Response.json({ name: 'autonomy-paused' });
    return new Response('', { status: 404 });
  };
  const s = bootServer({ githubFetch: fetchImpl });
  stubGithubApp(null);
  for (const repo of ['octo/alpha', 'octo/beta']) {
    const id = repo.split('/')[1] ?? repo;
    s.db
      .insert(project)
      .values({ id, teamId: s.team.id, name: id, repoKind: 'github', githubRepo: repo })
      .run();
  }
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'owner', accessToken: 'token', scope: 'repo' },
  );
  s.db
    .insert(todo)
    .values({
      id: 'todo-merged',
      teamId: s.team.id,
      projectId: 'alpha',
      title: 'merged',
      phase: 'done',
      phaseAt: 1,
      seqNum: 1,
      latestBuildId: 'build-merged',
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build-merged',
      todoId: 'todo-merged',
      withPlan: false,
      triggerSource: 'user',
      prNumber: 7,
      createdAt: 1,
    })
    .run();
  s.db
    .insert(autonomousMergeAdmission)
    .values({
      buildId: 'build-merged',
      teamId: s.team.id,
      state: 'merged',
      createdAt: 1,
      landedAt: 2,
    })
    .run();
  const poller = createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch: fetchImpl });
  return {
    s,
    issues,
    markerPaused: (repo: string) => readGithubAutonomyPause(fetchImpl, 'token', repo),
    sweep: () => poller.sweep(),
    paused: () => teamPausedForTest(s.db, s.team.id),
    setMain: (repo: string, sha: string) => heads.set(repo, sha),
    setCheck: (sha: string, state: Conclusion, attempt = 1) => {
      checks.set(sha, state);
      attempts.set(sha, attempt);
      attemptChecks.set(`${sha}:${attempt}`, state);
    },
    setWorkflow: (repo: string, id: number) => workflowIds.set(repo, id),
    setDefaultBranch: (repo: string, branch: string) => branches.set(repo, branch),
    addForeignGreen: () => {
      foreignGreen = true;
    },
    afterCheck: (fn: () => void) => {
      afterCheckRead = fn;
    },
    beforeMarkerClose: (fn: () => Promise<void>) => {
      beforeClose = fn;
    },
    beforeMarkerPublication: (fn: () => Promise<void>) => {
      beforePublication = fn;
    },
    failPublication: (repo: string) => failedPublications.add(repo),
    hideCheck: (repo: string) => unavailableChecks.add(repo),
    rows: () => s.db.select().from(autonomyPause).all(),
    dispose: () => s.dispose(),
  };
}

test('a red-main pause resumes on its own once the next main check passes, and says why', async () => {
  const w = world();
  try {
    await w.sweep();
    expect(w.paused()).toBe(true);
    w.setMain('octo/alpha', GREEN);
    await w.sweep();
    expect(w.paused()).toBe(false);
    const [row] = w.rows();
    expect(row).toMatchObject({
      source: 'main-red',
      resolvedBy: 'condition',
      resolvedReason: `Main check passed at ${GREEN} in octo/alpha.`,
    });
    expect([...w.issues.values()].every((issue) => !issue.open)).toBe(true);
    expect(
      [...w.issues.entries()].find(([key]) => key.startsWith('octo/alpha#'))?.[1].comments[0],
    ).toContain(GREEN);
    const beta = [...w.issues.entries()].find(([key]) => key.startsWith('octo/beta#'))?.[1];
    expect(beta?.comments[0]).not.toContain(GREEN);
    expect(beta?.comments[0]).not.toContain('octo/alpha');
    const teams = (await (await req(w.s.app, 'GET', '/api/teams')).json()) as {
      autonomyAutoResume: { resolvedReason: string } | null;
    }[];
    expect(teams[0]?.autonomyAutoResume?.resolvedReason).toContain(GREEN);
  } finally {
    w.dispose();
  }
});

test('the automatic admission and GitHub marker agree, without blocking a manual merge', async () => {
  const w = world();
  try {
    const { db, team } = w.s;
    for (const source of ['explicit', 'automatic']) {
      db.insert(todo)
        .values({
          id: source,
          teamId: team.id,
          projectId: 'alpha',
          title: source,
          phaseAt: 1,
          seqNum: source === 'explicit' ? 2 : 3,
        })
        .run();
      db.insert(build)
        .values({
          id: source,
          todoId: source,
          withPlan: false,
          triggerSource: 'user',
          createdAt: 1,
        })
        .run();
    }
    await w.sweep();
    expect(await w.markerPaused('octo/alpha')).toBe(true);
    expect(() => claimAutonomousMerge(db, 'automatic')).toThrow('autonomy-paused');
    expect(() => claimAutonomousMerge(db, 'explicit', true)).not.toThrow();
    w.setMain('octo/alpha', GREEN);
    await w.sweep();
    expect(await w.markerPaused('octo/alpha')).toBe(false);
    expect(() => claimAutonomousMerge(db, 'automatic')).not.toThrow();
  } finally {
    w.dispose();
  }
});

test('a pending main check keeps the pause and names what it waits for', async () => {
  const w = world();
  try {
    await w.sweep();
    w.setMain('octo/alpha', GREEN);
    w.setCheck(GREEN, 'pending');
    await w.sweep();
    expect(w.paused()).toBe(true);
    const teams = (await (await req(w.s.app, 'GET', '/api/teams')).json()) as {
      autonomyPauses: { waitsFor: unknown }[];
    }[];
    expect(teams[0]?.autonomyPauses[0]?.waitsFor).toEqual({
      kind: 'main-green',
      repo: 'octo/alpha',
      failedSha: RED,
    });
  } finally {
    w.dispose();
  }
});

test('a green main in another repository leaves the pause keyed on the red one', async () => {
  const w = world();
  try {
    await w.sweep();
    await w.sweep();
    expect(w.paused()).toBe(true);
  } finally {
    w.dispose();
  }
});

test('a manual pause never resumes on a green main', async () => {
  const w = world();
  try {
    w.setMain('octo/alpha', GREEN);
    await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}`, { autonomyPaused: true });
    await w.sweep();
    await w.sweep();
    expect(w.paused()).toBe(true);
  } finally {
    w.dispose();
  }
});

test('main flapping red, green, red pauses, resumes and pauses again on the new red head', async () => {
  const w = world();
  try {
    await w.sweep();
    w.setMain('octo/alpha', GREEN);
    await w.sweep();
    expect(w.paused()).toBe(false);
    w.setMain('octo/alpha', RED_AGAIN);
    await w.sweep();
    expect(w.paused()).toBe(true);
    expect(w.rows().filter((row) => row.resolvedAt === null)).toEqual([
      expect.objectContaining({ waitsFor: expect.objectContaining({ failedSha: RED_AGAIN }) }),
    ]);
  } finally {
    w.dispose();
  }
});

test('a new failing attempt at the same SHA opens a new pause after a green attempt', async () => {
  const w = world();
  try {
    await w.sweep();
    w.setCheck(RED, 'success', 2);
    await w.sweep();
    expect(w.paused()).toBe(false);
    w.setCheck(RED, 'failure', 3);
    await w.sweep();
    expect(w.paused()).toBe(true);
    expect(w.rows().filter((row) => row.resolvedAt === null)).toHaveLength(1);
  } finally {
    w.dispose();
  }
});

test('a green preflight at the same SHA cannot clear a failed check on the default branch', async () => {
  const w = world();
  try {
    await w.sweep();
    w.addForeignGreen();
    await w.sweep();
    expect(w.paused()).toBe(true);
  } finally {
    w.dispose();
  }
});

test('a workflow not named ci.yml supplies its own recovery signal', async () => {
  const w = world();
  try {
    w.setWorkflow('octo/alpha', 11);
    await w.sweep();
    expect(w.paused()).toBe(true);
    w.setMain('octo/alpha', GREEN);
    w.setWorkflow('octo/alpha', 12);
    await w.sweep();
    expect(w.paused()).toBe(true);
    w.setWorkflow('octo/alpha', 11);
    await w.sweep();
    expect(w.paused()).toBe(false);
  } finally {
    w.dispose();
  }
});

test('recovery does not close a marker published outside this server', async () => {
  const w = world();
  try {
    w.issues.set('octo/alpha#91', { open: true, comments: [] });
    await w.sweep();
    w.setMain('octo/alpha', GREEN);
    await w.sweep();
    expect(w.paused()).toBe(false);
    expect(w.issues.get('octo/alpha#91')).toEqual({ open: true, comments: [] });
    expect(
      [...w.issues.entries()].filter(([key, issue]) => key !== 'octo/alpha#91' && issue.open),
    ).toEqual([]);
  } finally {
    w.dispose();
  }
});

test('a blocked GitHub marker publication does not delay recording another red repository', async () => {
  const w = world();
  const release = deferred();
  const { db, team } = w.s;
  db.insert(todo)
    .values({
      id: 'beta-todo',
      teamId: team.id,
      projectId: 'beta',
      title: 'Beta',
      phaseAt: 1,
      seqNum: 2,
    })
    .run();
  db.insert(build)
    .values({
      id: 'beta-build',
      todoId: 'beta-todo',
      prNumber: 8,
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  db.insert(autonomousMergeAdmission)
    .values({ buildId: 'beta-build', teamId: team.id, state: 'merged', createdAt: 1, landedAt: 3 })
    .run();
  w.setMain('octo/beta', RED_AGAIN);
  w.beforeMarkerPublication(() => release.promise);
  const sweep = w.sweep();
  try {
    await vi.waitFor(() =>
      expect(
        w
          .rows()
          .map((row) => row.waitsFor?.repo)
          .sort(),
      ).toEqual(['octo/alpha', 'octo/beta']),
    );
  } finally {
    release.resolve();
    await sweep;
    w.dispose();
  }
});

test('an unrelated issue at a previously published repo and number is not closed', async () => {
  const w = world();
  try {
    await w.sweep();
    const [marker] = w.rows()[0]?.markers ?? [];
    if (marker === undefined) throw new Error('Missing marker');
    const key = `${marker.repo}#${marker.number}`;
    const replacement = { open: true, comments: [], nodeId: 'different-issue' };
    w.issues.set(key, replacement);
    w.setMain('octo/alpha', GREEN);
    await w.sweep();
    expect(w.paused()).toBe(false);
    expect(w.issues.get(key)).toEqual({ open: true, comments: [], nodeId: 'different-issue' });
  } finally {
    w.dispose();
  }
});

test('a renamed default branch controls recovery even when the old main is green', async () => {
  const w = world();
  try {
    await w.sweep();
    w.setDefaultBranch('octo/alpha', 'releases/default');
    await w.sweep();
    expect(w.paused()).toBe(true);
    w.setMain('octo/alpha', GREEN);
    await w.sweep();
    expect(w.paused()).toBe(false);
  } finally {
    w.dispose();
  }
});

test('an unreadable Actions signal never resumes a waiting pause', async () => {
  const w = world();
  try {
    await w.sweep();
    w.setMain('octo/alpha', GREEN);
    w.hideCheck('octo/alpha');
    await w.sweep();
    expect(w.paused()).toBe(true);
    expect(await w.markerPaused('octo/alpha')).toBe(true);
  } finally {
    w.dispose();
  }
});

test('the default branch head must still match when the green check is confirmed', async () => {
  const w = world();
  try {
    await w.sweep();
    w.setMain('octo/alpha', GREEN);
    w.afterCheck(() => w.setMain('octo/alpha', RED_AGAIN));
    await w.sweep();
    expect(w.rows().every((row) => row.resolvedBy !== 'condition')).toBe(true);
    expect(w.paused()).toBe(true);
  } finally {
    w.dispose();
  }
});

test.each(['condition', 'owner'] as const)(
  'a partial marker publication still cleans up through %s',
  async (by) => {
    const w = world();
    try {
      w.failPublication('octo/beta');
      await w.sweep();
      expect([...w.issues.values()]).toHaveLength(1);
      expect(w.paused()).toBe(true);
      if (by === 'condition') {
        w.setMain('octo/alpha', GREEN);
        await w.sweep();
      } else {
        await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}`, { autonomyPaused: false });
      }
      expect(w.paused()).toBe(false);
      expect([...w.issues.values()][0]?.open).toBe(false);
    } finally {
      w.dispose();
    }
  },
);

test('a manual pause inserted during automatic marker cleanup survives the next sweep', async () => {
  const w = world();
  const closing = deferred();
  const release = deferred();
  try {
    await w.sweep();
    w.setMain('octo/alpha', GREEN);
    w.beforeMarkerClose(() => {
      closing.resolve();
      return release.promise;
    });
    const sweep = w.sweep();
    await closing.promise;
    const manual = req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}`, { autonomyPaused: true });
    await vi.waitFor(() => expect(w.paused()).toBe(true));
    release.resolve();
    expect((await manual).status).toBe(200);
    await sweep;
    await w.sweep();
    expect(w.rows().filter((row) => row.resolvedAt === null)).toEqual([
      expect.objectContaining({ source: 'settings' }),
    ]);
    expect([...w.issues.values()].some((issue) => issue.open)).toBe(true);
  } finally {
    release.resolve();
    w.dispose();
  }
});

test('resume now records the owner and closes the published markers', async () => {
  const w = world();
  try {
    await w.sweep();
    const res = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}`, {
      autonomyPaused: false,
    });
    expect(res.status).toBe(200);
    expect(w.paused()).toBe(false);
    expect(w.rows()[0]).toMatchObject({ resolvedBy: 'owner' });
    expect([...w.issues.values()].every((issue) => !issue.open)).toBe(true);
    const team = (await res.json()) as { autonomyAutoResume: unknown };
    expect(team.autonomyAutoResume).toBeNull();
  } finally {
    w.dispose();
  }
});

test('a manual pause sharing the red pause marker stays paused after main turns green', async () => {
  const w = world();
  try {
    await w.sweep();
    await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}`, { autonomyPaused: true });
    w.setMain('octo/alpha', GREEN);
    await w.sweep();
    await w.sweep();
    expect(w.paused()).toBe(true);
    expect(w.rows().filter((row) => row.resolvedAt === null)).toEqual([
      expect.objectContaining({ source: 'settings' }),
    ]);
  } finally {
    w.dispose();
  }
});
