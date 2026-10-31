import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { build, message, project, tag, todo, todoTag } from '../src/db/schema.js';
import type { GateGithubPort, GateRaw } from '../src/services/merge-gate/github-port.js';
import { evaluateMergeGate } from '../src/services/merge-gate-run.js';
import { bootServer } from './helpers.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

function ok(body: unknown): GateRaw {
  return { kind: 'ok', status: 200, etag: null, link: null, body };
}

test.each(['modified', 'added'] as const)(
  'evaluateMergeGate binds the %s correction guard to the actual PR head',
  async (status) => {
    const s = bootServer();
    try {
      s.db
        .insert(project)
        .values({
          id: 'project',
          teamId: s.team.id,
          name: 'Project',
          repoKind: 'github',
          githubRepo: 'octo/demo',
        })
        .run();
      s.db
        .insert(todo)
        .values({
          id: 'task',
          projectId: 'project',
          teamId: s.team.id,
          title: 'Thread',
          phase: 'review',
          phaseAt: 1,
          seqNum: 1,
          latestBuildId: 'build',
          sourceKind: 'github-issue',
          sourceRef: 'github:octo/demo#1',
        })
        .run();
      s.db
        .insert(build)
        .values({
          id: 'build',
          todoId: 'task',
          withPlan: false,
          triggerSource: 'user',
          createdAt: 1,
          prNumber: 42,
        })
        .run();
      s.db
        .insert(tag)
        .values({ id: 'correction', projectId: 'project', name: 'correction', color: '#000000' })
        .run();
      s.db.insert(todoTag).values({ todoId: 'task', tagId: 'correction' }).run();
      const port: GateGithubPort = {
        pull: async () =>
          ok({
            number: 42,
            state: 'open',
            merged: false,
            draft: false,
            changed_files: 1,
            mergeable_state: 'clean',
            body: '',
            head: { sha: HEAD, ref: 'lane/correction', repo: { full_name: 'octo/demo' } },
            base: { ref: 'main', repo: { full_name: 'octo/demo', default_branch: 'main' } },
          }),
        branch: async () => ok({ commit: { sha: BASE }, protected: false }),
        branchRules: async () => ok([]),
        compare: async () =>
          ok({
            total_commits: 1,
            behind_by: 0,
            commits: [{ sha: HEAD, parents: [{ sha: BASE }] }],
            files: [
              {
                filename: 'apps/server/test/new-guard.test.ts',
                status,
                sha: 'c'.repeat(40),
                additions: 1,
                deletions: 0,
                patch: '@@ -0,0 +1 @@\n+guard',
              },
            ],
          }),
        checkRuns: async () => ok({ total_count: 0, check_runs: [] }),
        combinedStatus: async () =>
          ok({ sha: HEAD, state: 'success', total_count: 0, statuses: [] }),
        contents: async () => ok([]),
        createStatus: async () => ok({}),
      };
      const result = await evaluateMergeGate(s.svc, 'build', { port });
      expect(result).not.toBeNull();
      expect(result?.headSha).toBe(HEAD);
      expect(
        result?.blockers.some((blocker) =>
          blocker.detail.some((detail) => detail.includes('Correction')),
        ),
      ).toBe(status !== 'added');
      expect(
        s.db
          .select()
          .from(message)
          .where(eq(message.id, `correction-guard:build:${HEAD}`))
          .get()?.content,
      ).toEqual({ kind: 'correction_guard', headSha: HEAD, passed: status === 'added' });
      expect(
        s.db
          .select()
          .from(message)
          .where(eq(message.id, `correction-guard:build:${BASE}`))
          .get(),
      ).toBeUndefined();
    } finally {
      s.dispose();
    }
  },
);
