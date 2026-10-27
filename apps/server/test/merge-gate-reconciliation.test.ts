import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { build, message, project, step, todo } from '../src/db/schema.js';
import { requestMerge } from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { evaluateProductGate as evaluateMergeGate } from '../src/services/machine-gate-port.js';
import { bootServer, postProject } from './helpers.js';

vi.mock('../src/services/machine-gate-port.js', () => ({ evaluateProductGate: vi.fn() }));

test.each(['null', 'facts-failed', 'open-race'])(
  'a merged PR with %s audit stays queued until terminal audit succeeds',
  async (scenario) => {
    const s = bootServer();
    try {
      const projectId = await postProject(s.app, 'audit');
      s.db
        .update(project)
        .set({ repoKind: 'github', githubRepo: 'owner/repo' })
        .where(eq(project.id, projectId))
        .run();
      s.db
        .insert(todo)
        .values({
          id: 'audit-todo',
          teamId: s.team.id,
          projectId,
          title: 'Audit a merged PR',
          phase: 'review',
          phaseAt: 1,
          seqNum: 1,
          latestBuildId: 'audit-build',
        })
        .run();
      s.db
        .insert(build)
        .values({
          id: 'audit-build',
          todoId: 'audit-todo',
          withPlan: false,
          triggerSource: 'user',
          prNumber: 7,
          createdAt: 1,
        })
        .run();
      const events: string[] = [];
      let auditAttempts = 0;
      let recovered = false;
      vi.mocked(evaluateMergeGate).mockImplementation(async (_deps, _id, opts) => {
        auditAttempts += 1;
        if (!opts?.requireAudit) {
          events.push('initial-evaluation');
          if (scenario === 'facts-failed' && !recovered)
            throw new Error('Initial GitHub facts unreadable');
          return scenario === 'open-race'
            ? {
                ready: false,
                headSha: 'a'.repeat(40),
                patchDigest: null,
                policy: 'human',
                blockers: [],
              }
            : null;
        }
        events.push(recovered ? 'audit-passed' : 'audit-failed');
        if (!recovered) {
          if (scenario === 'null') return null;
          throw new Error(
            scenario === 'facts-failed'
              ? 'GitHub facts unreadable'
              : 'Facts still show open before merged reconciliation',
          );
        }
        return {
          ready: false,
          headSha: 'a'.repeat(40),
          patchDigest: null,
          policy: 'human',
          blockers: [],
        };
      });
      const poller = createCiPoller(s.svc, {
        githubFetch: async () => {
          events.push('read-merged');
          return Response.json({
            number: 7,
            state: 'closed',
            merged: true,
            merge_commit_sha: 'b'.repeat(40),
            merged_by: { login: 'owner' },
            head: { sha: 'a'.repeat(40), ref: conversationBranch('audit-build'), repo: { id: 1 } },
            base: { ref: 'main', repo: { id: 1, default_branch: 'main' } },
          });
        },
      });
      await poller.sweep(1_000);
      expect(s.db.select().from(todo).where(eq(todo.id, 'audit-todo')).get()?.phase).toBe('review');
      expect(events.slice(0, 3)).toEqual(['initial-evaluation', 'read-merged', 'audit-failed']);
      recovered = true;
      await poller.sweep(400_000);
      expect(s.db.select().from(todo).where(eq(todo.id, 'audit-todo')).get()?.phase).toBe('done');
      expect(
        vi.mocked(evaluateMergeGate).mock.calls.some((call) => call[2]?.requireAudit === true),
      ).toBe(true);
      await poller.sweep(800_000);
      const attempts = auditAttempts;
      await poller.sweep(1_200_000);
      expect(auditAttempts).toBe(attempts);
    } finally {
      s.dispose();
    }
  },
);

test('a real human GitHub merge waits for retryable audit before completing', async () => {
  const s = bootServer();
  try {
    const projectId = await postProject(s.app, 'human audit');
    s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'owner/repo' })
      .where(eq(project.id, projectId))
      .run();
    s.db
      .insert(todo)
      .values({
        id: 'human-todo',
        teamId: s.team.id,
        projectId,
        title: 'Human merge audit',
        phase: 'review',
        phaseAt: 1,
        seqNum: 1,
        latestBuildId: 'human-build',
      })
      .run();
    s.db
      .insert(build)
      .values({
        id: 'human-build',
        todoId: 'human-todo',
        withPlan: false,
        triggerSource: 'user',
        prNumber: 7,
        createdAt: 1,
      })
      .run();
    s.db
      .insert(step)
      .values({
        id: 'human-delivery',
        buildId: 'human-build',
        kind: 'build',
        status: 'done',
        checkpointCommit: 'a'.repeat(40),
        createdAt: 1,
        finishedAt: 2,
      })
      .run();
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'owner', accessToken: 'test-human-gate-token', scope: 'repo' },
    );
    let merged = false;
    let mergeRequests = 0;
    const githubFetch: NonNullable<Parameters<typeof requestMerge>[0]['githubFetch']> = async (
      input,
      init,
    ) => {
      if (init?.method === 'PUT') {
        mergeRequests += 1;
        merged = true;
        return Response.json({ merged: true, sha: 'b'.repeat(40) });
      }
      if (!String(input).endsWith('/pulls/7')) return Response.json([]);
      return Response.json({
        number: 7,
        title: 'Human audit',
        state: merged ? 'closed' : 'open',
        merged,
        author_association: 'OWNER',
        merge_commit_sha: merged ? 'b'.repeat(40) : null,
        merged_by: merged ? { login: 'owner' } : null,
        head: { sha: 'a'.repeat(40), ref: conversationBranch('human-build'), repo: { id: 1 } },
        base: { ref: 'main', repo: { id: 1, default_branch: 'main' } },
      });
    };
    const deps = { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, githubFetch };
    await requestMerge(deps, 'human-build');
    expect(merged).toBe(true);
    expect(s.db.select().from(todo).where(eq(todo.id, 'human-todo')).get()?.phase).toBe('review');
    let recovered = false;
    let audits = 0;
    vi.mocked(evaluateMergeGate).mockImplementation(async (_deps, _id, options) => {
      if (!options?.requireAudit) return null;
      audits += 1;
      if (!recovered) throw new Error('Audit temporarily unavailable');
      return {
        ready: false,
        headSha: 'a'.repeat(40),
        patchDigest: null,
        policy: 'human',
        blockers: [],
      };
    });
    const poller = createCiPoller(deps, { githubFetch });
    await poller.sweep(1000);
    expect(s.db.select().from(todo).where(eq(todo.id, 'human-todo')).get()?.phase).toBe('review');
    expect(
      s.db
        .select()
        .from(message)
        .where(eq(message.conversationId, 'human-build'))
        .all()
        .some((row) => String(row.content).includes('审计尚未确认')),
    ).toBe(true);
    recovered = true;
    await poller.sweep(400000);
    expect(s.db.select().from(todo).where(eq(todo.id, 'human-todo')).get()?.phase).toBe('done');
    await poller.sweep(800000);
    expect(audits).toBe(2);
    expect(mergeRequests).toBe(1);
  } finally {
    s.dispose();
  }
});
