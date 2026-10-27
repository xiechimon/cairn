import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { build, project, todo } from '../src/db/schema.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { evaluateProductGate as evaluateMergeGate } from '../src/services/machine-gate-port.js';
import { bootServer, postProject } from './helpers.js';

vi.mock('../src/services/machine-gate-port.js', () => ({ evaluateProductGate: vi.fn() }));

test('a failed merged-head audit stays queued and reconciliation retries it before finishing', async () => {
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
    vi.mocked(evaluateMergeGate).mockImplementation(async () => {
      auditAttempts += 1;
      events.push(auditAttempts === 1 ? 'audit-failed' : 'audit-passed');
      if (auditAttempts === 1) throw new Error('Mismatch issue write temporarily failed');
      return null;
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
    expect(events).toEqual(['audit-failed']);
    await poller.sweep(400_000);
    expect(s.db.select().from(todo).where(eq(todo.id, 'audit-todo')).get()?.phase).toBe('done');
    expect(events).toEqual(['audit-failed', 'audit-passed', 'read-merged']);
    await poller.sweep(800_000);
    expect(auditAttempts).toBe(2);
  } finally {
    s.dispose();
  }
});
