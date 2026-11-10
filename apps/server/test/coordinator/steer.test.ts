import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { chiefMessage, coordinatorInput, step } from '../../src/db/schema.js';
import * as questions from '../../src/services/chief-questions.js';
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

describe('Coordinator steer', () => {
  it('delivers each steered message into the running turn once, even with identical text, and never runs its step', async () => {
    const questionCalls = vi.spyOn(questions, 'holdForQuestion');
    const w = await world('start the work');
    const { faux } = stub('unused');
    const requests: string[] = [];
    faux.setResponses([
      (c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage([fauxToolCall('ask_user', QUESTION)], {
          stopReason: 'toolUse',
        });
      },
      (c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('adjusted');
      },
      (c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage([fauxToolCall('ask_user', QUESTION)], {
          stopReason: 'toolUse',
        });
      },
      (c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('acknowledged');
      },
    ]);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    const questionRows = () =>
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .filter((m) => JSON.stringify(m.content).includes('ask_user_question'));
    await until(() => questionRows().length === 1);

    const steerNew = async () => {
      const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
        content: 'switch to the cheaper plan',
      });
      expect(sent.status).toBeLessThan(300);
      const queued = w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .filter((m) => m.role === 'user' && JSON.stringify(m.content).includes('cheaper plan'))
        .find((m) => w.s.db.select().from(step).where(eq(step.id, m.id)).get() !== undefined);
      const steered = await req(
        w.s.app,
        'POST',
        `/api/teams/${w.teamId}/chief/threads/${w.threadId}/messages/${queued?.id}/steer`,
      );
      expect(steered.status).toBe(200);
      await until(
        () =>
          w.s.db
            .select()
            .from(coordinatorInput)
            .where(eq(coordinatorInput.id, queued?.id ?? ''))
            .get()?.conversationId != null,
      );
      expect(
        w.s.db
          .select()
          .from(step)
          .where(eq(step.id, queued?.id ?? ''))
          .get()?.holdReason,
      ).toBe('steer');
      expect(
        w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.ownerMessageIds,
      ).not.toContain(queued?.id);
    };
    await steerNew();
    await steerNew();

    const answered = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${questionRows()[0]?.id}/answer`,
      { answers: [{ header: 'Pick', choices: ['A'] }] },
    );
    expect(answered.status).toBe(200);
    await until(() => questionRows().length === 2);
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('claimed');
    await coordinator.close();
    const restarted = boot(w, faux);
    restarted.wake(w.threadId);
    await vi.waitFor(() => expect(questionCalls).toHaveBeenCalledTimes(3));
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('claimed');
    const lateAnswer = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${questionRows()[1]?.id}/answer`,
      { answers: [{ header: 'Pick', choices: ['A'] }] },
    );
    expect(lateAnswer.status).toBe(200);
    await until(() => w.s.db.select().from(step).get()?.status === 'done');
    restarted.wake(w.threadId);
    await restarted.idle();

    expect(requests).toHaveLength(4);
    expect(requests[1]?.split('switch to the cheaper plan')).toHaveLength(2);
    expect(requests[2]?.split('switch to the cheaper plan')).toHaveLength(3);
    expect(w.s.db.select().from(step).all()).toHaveLength(1);
  });
});
