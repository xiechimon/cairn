import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { build, message, steerPending, step, todo } from '../src/db/schema.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { claimStep } from '../src/services/machine-claim.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { AGENT_ID, ctx, H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { bindAllAgents, insertMachine } from './helpers.js';

registerChiefHarness();

function seedThread(phase: 'building' | 'review' | 'done', status: 'claimed' | 'done' = 'done') {
  H.s.db
    .insert(todo)
    .values({
      id: 'message-todo',
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Message the worker',
      phase,
      phaseAt: 1,
      seqNum: 1,
      latestBuildId: 'message-build',
      assignment: { plan: null, build: { agentId: AGENT_ID } },
    })
    .run();
  H.s.db
    .insert(build)
    .values({
      id: 'message-build',
      todoId: 'message-todo',
      withPlan: false,
      triggerSource: 'chief',
      createdAt: 1,
    })
    .run();
  H.s.db
    .insert(step)
    .values({
      id: 'message-step',
      buildId: 'message-build',
      kind: 'build',
      status,
      sessionId: 'worker-session',
      createdAt: 1,
    })
    .run();
}

describe.each(['chief', 'mcp'] as const)('%s message_todo', (entry) => {
  async function send(todoId = 'message-todo', content = 'Include regression coverage') {
    const deps = { ...toolDeps(), convHub: H.s.convHub };
    const args = { todoId, content };
    const result =
      entry === 'chief'
        ? await executeChiefTool(deps, ctx(), 'message_todo', args)
        : await executeMcpTool(
            deps,
            { teamId: H.teamId, user: H.s.user, grants: new Set(['Message Todo']) },
            'message_todo',
            args,
          );
    return JSON.parse(result) as Record<string, unknown>;
  }

  test('delivers a claimed step steer and publishes the user message once', async () => {
    seedThread('building', 'claimed');
    const signal = vi.spyOn(H.s.machineHub, 'steerSignal');
    const publish = vi.spyOn(H.s.convHub, 'publishMessage');
    expect(await send()).toMatchObject({
      todoId: 'message-todo',
      conversationId: 'message-build',
      posted: true,
      delivered: 'steer',
    });
    expect(H.s.db.select().from(steerPending).all()).toEqual([
      {
        conversationId: 'message-build',
        stepId: 'message-step',
        content: 'Include regression coverage',
        createdAt: expect.any(Number),
      },
    ]);
    expect(signal).toHaveBeenCalledExactlyOnceWith(H.teamId, 'message-step');
    const messages = H.s.db.select().from(message).all();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Include regression coverage' });
    expect(publish).toHaveBeenCalledExactlyOnceWith('message-build', {
      id: messages[0]!.id,
      role: 'user',
      content: 'Include regression coverage',
      createdAt: messages[0]!.createdAt,
      actor: null,
    });
    expect(H.s.db.select().from(step).all()).toHaveLength(1);
  });

  test.each(['done', 'review'] as const)(
    'continues an idle %s todo on its existing build',
    async (phase) => {
      seedThread(phase);
      const wake = vi.spyOn(H.s.machineHub, 'wake');
      const publish = vi.spyOn(H.s.convHub, 'publishMessage');
      expect(await send()).toMatchObject({
        posted: true,
        conversationId: 'message-build',
        delivered: 'new-turn',
      });
      expect(H.s.db.select().from(build).all()).toHaveLength(1);
      const steps = H.s.db.select().from(step).all();
      expect(steps).toHaveLength(2);
      expect(steps.find((row) => row.id !== 'message-step')).toMatchObject({
        buildId: 'message-build',
        kind: 'build',
        status: 'pending',
        prompt: 'Include regression coverage',
        freshSession: false,
      });
      expect(H.s.db.select().from(todo).get()).toMatchObject({
        phase: 'queued',
        latestBuildId: 'message-build',
      });
      expect(H.s.db.select().from(build).get()?.prevPhase).toBe(phase);
      expect(H.s.db.select().from(steerPending).all()).toEqual([]);
      expect(H.s.db.select().from(message).get()).toMatchObject({
        conversationId: 'message-build',
        role: 'user',
        content: 'Include regression coverage',
      });
      expect(wake).toHaveBeenCalledExactlyOnceWith(H.teamId);
      expect(publish).toHaveBeenCalledTimes(1);
      await expect(send('message-todo', 'Duplicate turn')).rejects.toThrow();
      expect(H.s.db.select().from(step).all()).toHaveLength(2);
      expect(H.s.db.select().from(message).all()).toHaveLength(1);
    },
  );

  test.each(['review', 'verify'] as const)(
    'continues the builder session after a later %s session',
    async (kind) => {
      seedThread('review');
      const machineId = insertMachine(H.s);
      bindAllAgents(H.s, machineId);
      H.s.db
        .insert(step)
        .values({
          id: 'later-gate-step',
          buildId: 'message-build',
          kind,
          status: 'done',
          sessionId: 'gate-session',
          machineId,
          createdAt: 2,
        })
        .run();
      expect(await send()).toMatchObject({ posted: true, delivered: 'new-turn' });
      const claimed = await claimStep(toolDeps(), machineId, H.teamId, 0, 'http://localhost');
      expect(claimed).toMatchObject({
        conversationId: 'message-build',
        step: { kind: 'build' },
        session: { action: 'continue', sessionId: 'worker-session' },
        instruction: 'Include regression coverage',
      });
    },
  );

  test('returns a readable failure without a build or transcript side effects', async () => {
    seedThread('done');
    H.s.db.update(todo).set({ latestBuildId: null }).where(eq(todo.id, 'message-todo')).run();
    const signal = vi.spyOn(H.s.machineHub, 'steerSignal');
    const result = await send();
    expect(result).toMatchObject({ posted: false, conversationId: null, todoId: 'message-todo' });
    expect(result.error).toEqual(expect.stringMatching(/no build/i));
    expect(H.s.db.select().from(message).all()).toEqual([]);
    expect(signal).not.toHaveBeenCalled();
  });

  test('rejects a todo outside the caller team', async () => {
    seedThread('building', 'claimed');
    H.teamId = 'other-team';
    await expect(send()).rejects.toThrow('todo message-todo');
    expect(H.s.db.select().from(message).all()).toEqual([]);
    expect(H.s.db.select().from(steerPending).all()).toEqual([]);
  });
});
