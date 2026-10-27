import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { build, project, todo } from '../src/db/schema.js';
import { createCiPoller } from '../src/services/ci-loop.js';
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
