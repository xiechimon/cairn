import { rmSync } from 'node:fs';
import { buildVerifyStepPrompt } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { build, gateVerdict, message, project, step, todo } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { flushVerdictDigests } from '../src/services/build-gate-verdict.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import type { GateGithubPort, GateRaw } from '../src/services/merge-gate/github-port.js';
import { evaluateMergeGate } from '../src/services/merge-gate-run.js';
import { bootServer, issueApiKey, postProject } from './helpers.js';

let throttleHome: string;
beforeAll(() => {
  throttleHome = makeTestTempDir('verify-pr-comment-');
  vi.stubEnv('CAIRN_HOME', throttleHome);
  vi.stubEnv('CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS', '0');
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(throttleHome, { recursive: true, force: true });
});

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const NEXT = 'c'.repeat(40);
const FILES = [
  {
    filename: 'src/a.ts',
    status: 'modified',
    sha: BASE,
    additions: 1,
    deletions: 1,
    patch: '@@ -1 +1 @@\n-a\n+b',
  },
];
const ok = (body: unknown): GateRaw => ({ kind: 'ok', status: 200, body, etag: null, link: null });
const response = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

async function world(mode: 'attachments' | 'repository' | null = 'attachments') {
  const comments: { body: string; user: { login: string } }[] = [];
  const writes: string[] = [];
  let failure: 'before' | 'after' | null = null;
  let head = HEAD;
  let conclusion: string | undefined;
  const githubFetch: FetchLike = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/comments')) {
      if (init?.method === 'POST') {
        const body = (JSON.parse(String(init.body)) as { body: string }).body;
        writes.push(body);
        if (failure === 'before') throw new Error('GitHub unavailable');
        comments.push({ body, user: { login: 'octo' } });
        if (failure === 'after') throw new Error('response lost');
        return response({ id: comments.length }, 201);
      }
      return response(comments);
    }
    if (path.includes('/pulls/')) return response({ base: { sha: BASE }, head: { sha: head } });
    if (path.includes('/compare/'))
      return response({
        files: FILES,
        total_commits: 1,
        behind_by: 0,
        commits: [{ sha: head, parents: [{ sha: BASE }] }],
      });
    return response({ message: 'Not found' }, 404);
  };
  const s = bootServer({ githubFetch, webOrigin: 'https://cairn.example' });
  const bootstrap = await issueApiKey(s);
  const enrolled = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${bootstrap}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'comment-machine', cliVersion: '0.1.0' }),
  });
  expect(enrolled.status).toBe(200);
  const machine = (await enrolled.json()) as { machineId: string; token: string };
  const projectId = await postProject(s.app);
  s.db
    .update(project)
    .set({
      repoKind: 'github',
      githubRepo: 'octo/demo',
      evidenceStore: mode === 'repository' ? 'attachments' : 'repository',
    })
    .where(eq(project.id, projectId))
    .run();
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      login: 'octo',
      accessToken: 'test-token',
      scope: 'repo',
    },
  );
  s.db
    .insert(todo)
    .values({
      id: 'comment-todo',
      teamId: s.team.id,
      projectId,
      title: 'Verify comment',
      phase: 'review',
      phaseAt: 1,
      seqNum: 3513,
      latestBuildId: 'comment-build',
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'comment-build',
      todoId: 'comment-todo',
      withPlan: false,
      triggerSource: 'user',
      prNumber: 7,
      evidenceStore: mode,
      createdAt: 1,
    })
    .run();
  const port: GateGithubPort = {
    pull: async () =>
      ok({
        number: 7,
        state: 'open',
        merged: false,
        draft: false,
        changed_files: 1,
        body: '',
        mergeable_state: 'clean',
        head: { sha: head, ref: 'lane', repo: { full_name: 'octo/demo' } },
        base: { ref: 'main', repo: { full_name: 'octo/demo', default_branch: 'main' } },
      }),
    branch: async () => ok({ commit: { sha: BASE }, protected: false }),
    branchRules: async () => ok([]),
    compare: async () =>
      ok({
        files: FILES,
        total_commits: 1,
        behind_by: 0,
        commits: [{ sha: head, parents: [{ sha: BASE }] }],
      }),
    checkRuns: async () => ok({ total_count: 0, check_runs: [] }),
    combinedStatus: async () => ok({ sha: head, total_count: 0, statuses: [] }),
    contents: async () => ok([]),
    createStatus: async () => ok({}),
  };
  const deps = {
    ...s.svc,
    githubFetch,
    box: s.secretBox,
    githubAppIdentity: null as { name: string; email: string } | null,
  };
  async function verify(id = 'verify-1', passed = true, reported: string | null = head) {
    s.db
      .insert(step)
      .values({
        id,
        buildId: 'comment-build',
        kind: 'verify',
        machineId: machine.machineId,
        status: 'claimed',
        prompt: buildVerifyStepPrompt({
          ticketRef: '3513',
          taskText: 'Verify comment',
          planText: '',
          pr: null,
          expectedHeadSha: head,
          evidenceStore: mode ?? 'attachments',
        }),
        createdAt: 1,
      })
      .run();
    const report = {
      status: 'success',
      ...(reported === null ? {} : { gateHeadSha: reported }),
      verifyVerdict: {
        passed,
        conclusion: conclusion ?? `Checked API and retry (${id})`,
        evidence: [{ path: 'attachment:private-token', note: 'private proof' }],
      },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const done = await s.app.request(`/api/machine/done/${id}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${machine.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(report),
      });
      expect(done.status).toBe(200);
    }
    await flushVerdictDigests();
  }
  const poll = () => evaluateMergeGate(deps, 'comment-build', { port });
  return {
    s,
    comments,
    writes,
    verify,
    poll,
    deps,
    setConclusion: (value: string) => {
      conclusion = value;
    },
    setHead: (value: string) => {
      head = value;
    },
    fail: (value: typeof failure) => {
      failure = value;
    },
  };
}

test('a passing attachments verify posts only verdict, judged head, conclusion and configured thread link', async () => {
  const w = await world();
  await w.verify();
  await w.poll();
  expect(w.comments).toHaveLength(1);
  expect(w.comments[0]?.body).toContain('PASS');
  expect(w.comments[0]?.body).toContain(HEAD);
  expect(w.comments[0]?.body).toContain('Checked API and retry (verify-1)');
  expect(w.comments[0]?.body).toContain('https://cairn.example/app?thread=comment-todo');
  expect(w.comments[0]?.body).not.toMatch(/private|attachment:|!\[/);
});

test('repeated polls, concurrent polls and another verify on the same judged head post once', async () => {
  const w = await world();
  await w.verify();
  await Promise.all([w.poll(), w.poll()]);
  await w.verify('verify-2');
  await w.poll();
  expect(w.comments).toHaveLength(1);
  expect(w.writes).toHaveLength(1);
});

test('a newly judged head gets its own comment and its own conclusion', async () => {
  const w = await world();
  await w.verify();
  await w.poll();
  w.setHead(NEXT);
  await w.verify('verify-2');
  await w.poll();
  expect(w.comments).toHaveLength(2);
  expect(w.comments[1]?.body).toContain(NEXT);
  expect(w.comments[1]?.body).toContain('(verify-2)');
});

test.each(['repository', null] as const)(
  '%s snapshot never posts despite the live project setting',
  async (mode) => {
    const w = await world(mode);
    await w.verify();
    await w.poll();
    expect(w.writes).toEqual([]);
    const rows = w.s.db.select().from(message).all();
    const verdict = rows
      .map((row) => (typeof row.content === 'string' ? JSON.parse(row.content) : row.content))
      .find((row) => row?.kind === 'verify_verdict');
    if (mode === 'repository') expect(verdict).not.toHaveProperty('stepId');
  },
);

test.each([
  'failed',
  'missing-head',
  'drifted-head',
  'wrong-digest',
  'step-failed',
  'extraction-failed',
] as const)('%s verdict never posts', async (failure) => {
  const w = await world();
  await w.verify(
    'verify-1',
    failure !== 'failed',
    failure === 'missing-head' ? null : failure === 'drifted-head' ? NEXT : HEAD,
  );
  if (failure === 'wrong-digest') w.s.db.update(gateVerdict).set({ patchDigest: 'bad' }).run();
  if (failure === 'step-failed' || failure === 'extraction-failed')
    w.s.db
      .update(gateVerdict)
      .set({ outcome: failure === 'step-failed' ? 'step_failed' : 'extraction_failed' })
      .run();
  await w.poll();
  expect(w.writes).toEqual([]);
});

test('GitHub failure logs, preserves the verdict and retries on the next existing poll', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const w = await world();
    await w.verify();
    const before = w.s.db.select().from(gateVerdict).all();
    w.fail('before');
    await w.poll();
    expect(w.s.db.select().from(gateVerdict).all()).toEqual(before);
    expect(warn.mock.calls.some(([text]) => String(text).includes('Verify PR comment'))).toBe(true);
    w.fail(null);
    await w.poll();
    expect(w.comments).toHaveLength(1);
  } finally {
    warn.mockRestore();
  }
});

test('a lost POST response is reconciled from GitHub rather than posted again', async () => {
  const w = await world();
  await w.verify();
  w.fail('after');
  await w.poll();
  w.fail(null);
  await w.poll();
  expect(w.comments).toHaveLength(1);
  expect(w.writes).toHaveLength(1);
});

test('the conclusion cannot render embedded images or export attachment tokens', async () => {
  const w = await world();
  w.setConclusion(
    'Checked ![proof](attachment:private-token) and <img src="https://example.com/proof.png">',
  );
  await w.verify();
  await w.poll();
  expect(w.comments).toHaveLength(1);
  expect(w.comments[0]?.body).toContain('Checked');
  expect(w.comments[0]?.body).not.toMatch(/!\[|<img|private-token/);
});

test('a prior comment from the configured App identity deduplicates during user-token fallback', async () => {
  const w = await world();
  await w.verify();
  w.deps.githubAppIdentity = { name: 'example-app[bot]', email: 'bot@example.com' };
  w.comments.push({
    body: `<!-- cairn:verify:${HEAD} -->\nVerify verdict: PASS`,
    user: { login: 'example-app[bot]' },
  });
  await w.poll();
  expect(w.writes).toEqual([]);
});

test('an unreadable comment list defers writing until a later poll', async () => {
  const w = await world();
  await w.verify();
  const githubFetch = w.deps.githubFetch;
  w.deps.githubFetch = async (input, init) =>
    new URL(String(input)).pathname.endsWith('/comments') && init?.method !== 'POST'
      ? response({ message: 'Unavailable' }, 503)
      : githubFetch(input, init);
  await w.poll();
  expect(w.writes).toEqual([]);
  w.deps.githubFetch = githubFetch;
  await w.poll();
  expect(w.comments).toHaveLength(1);
});

test.each([
  'attachment:private-token',
  '[proof](attachment:private-token)',
  '![proof](attachment:private-token)',
  '[proof](ATTACHMENT:private-token)',
  'attach\u200bment:private-token',
])('the public conclusion strips every attachment URI form: %s', async (reference) => {
  const w = await world();
  w.setConclusion(`Checked API: ${reference}`);
  await w.verify();
  await w.poll();
  expect(w.comments).toHaveLength(1);
  expect(w.comments[0]?.body).toContain('Checked API');
  expect(w.comments[0]?.body).not.toMatch(/attachment:|private-token/i);
});
