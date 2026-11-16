import { QUICK_SESSION_BRIEF, SESSION_BRIEF } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { step } from '../src/db/schema.js';
import { applyBuildStepAction, applyStepFailure } from '../src/services/builds.js';
import { getTodo } from '../src/services/todos.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

function deps() {
  return {
    db: H.s.db,
    hub: H.s.hub,
    convHub: H.s.convHub,
    machineHub: H.s.machineHub,
    user: H.s.user,
  };
}

async function channelTask(lane: 'quick' | undefined): Promise<{ id: string; buildId: string }> {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/channels/${H.projectId}`);
  const channel = ((await res.json()) as { id: string }).id;
  const words = seedOwnerMessage(H.s.db, channel, 'add a node.txt that says hello');
  return (await relay(
    'create_todo',
    { projectId: H.projectId, messageIds: [words], ...(lane ? { lane } : {}) },
    { threadId: channel, conversationId: channel, turnMessageIds: [words], turnPrompt: 'add it' },
  )) as { id: string; buildId: string };
}

function sessionPrompt(buildId: string): string {
  return H.s.db.select().from(step).where(eq(step.buildId, buildId)).all()[0]!.prompt ?? '';
}

describe('quick session brief (docs/design/quick-lane.md L4, L8)', () => {
  test('a quick task starts its session with the quick brief', async () => {
    const created = await channelTask('quick');
    const prompt = sessionPrompt(created.buildId);
    expect(prompt.startsWith(QUICK_SESSION_BRIEF)).toBe(true);
    expect(QUICK_SESSION_BRIEF.endsWith(SESSION_BRIEF)).toBe(true);
  });

  test('an ordinary task in the same channel keeps the full brief', async () => {
    const created = await channelTask(undefined);
    const prompt = sessionPrompt(created.buildId);
    expect(prompt.startsWith(SESSION_BRIEF)).toBe(true);
    expect(prompt).not.toContain(QUICK_SESSION_BRIEF);
  });

  test('a retried quick task keeps the quick brief', async () => {
    const created = await channelTask('quick');
    const pending = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, created.buildId))
      .all()
      .find((row) => row.status === 'pending')!;
    applyStepFailure(deps(), pending, 'runner crashed');
    await applyBuildStepAction(deps(), created.buildId, {
      action: 'restart',
      feedback: '',
      clientMessageId: 'retry-1',
    });
    const retried = getTodo(deps(), created.id)!.latestBuildId!;
    expect(retried).not.toBe(created.buildId);
    expect(sessionPrompt(retried).startsWith(QUICK_SESSION_BRIEF)).toBe(true);
  });
});
