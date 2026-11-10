import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { chiefMessage, coordinatorInput, step } from '../../src/db/schema.js';
import { req } from '../helpers.js';
import { boot, stub, world } from './runner-world.js';

const QUESTION = {
  questions: [
    { header: 'Pick', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] },
  ],
};

async function until(check: () => boolean, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Coordinator stop', () => {
  const stopWithPendingInput = async (withSteer: boolean) => {
    const w = await world('long job');
    const { faux } = stub('unused');
    let requests = 0;
    faux.setResponses([
      () => {
        requests++;
        return fauxAssistantMessage([fauxToolCall('ask_user', QUESTION)], {
          stopReason: 'toolUse',
        });
      },
      () => {
        requests++;
        return fauxAssistantMessage('should not be asked');
      },
    ]);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await until(() =>
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .some((m) => JSON.stringify(m.content).includes('ask_user_question')),
    );

    let steerId: string | undefined;
    if (withSteer) {
      const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
        content: 'Retain this unconsumed correction.',
      });
      steerId = ((await sent.json()) as { message: { id: string } }).message.id;
      expect(
        (
          await req(
            w.s.app,
            'POST',
            `/api/teams/${w.teamId}/chief/threads/${w.threadId}/messages/${steerId}/steer`,
          )
        ).status,
      ).toBe(200);
      await vi.waitFor(
        () =>
          expect(
            w.s.db
              .select()
              .from(coordinatorInput)
              .all()
              .find((input) => input.id === steerId)?.conversationId,
          ).toEqual(expect.any(String)),
        { timeout: 8000 },
      );
    }
    const stopped = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/stop`,
    );
    expect(stopped.status).toBe(200);
    await until(() => w.s.db.select().from(step).get()?.status === 'stopped');
    await coordinator.idle();

    expect(requests).toBe(withSteer ? 2 : 1);
    if (withSteer) {
      const input = w.s.db
        .select()
        .from(coordinatorInput)
        .all()
        .find((input) => input.id === steerId)!;
      expect(input).toMatchObject({ state: 'released', entryId: null });
      const successor = w.s.db
        .select()
        .from(step)
        .all()
        .find((row) => row.id === input.successorStepId);
      expect(successor).toMatchObject({ status: 'done', ownerMessageIds: [steerId] });
      expect(w.s.db.select().from(step).all()).toHaveLength(2);
    }
    expect(w.s.db.select().from(step).get()?.status).toBe('stopped');
  };
  it.each([false, true])(
    'stops a waiting turn and reconciles admitted steer (%s) before successor execution',
    stopWithPendingInput,
    15000,
  );
});
