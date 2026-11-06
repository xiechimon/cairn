import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { chiefMessage, step } from '../../src/db/schema.js';
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
  it('delivers a steered message into the running turn once and never runs its step', async () => {
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
        return fauxAssistantMessage('unexpected extra turn');
      },
    ]);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    const questionRow = () =>
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .find((m) => JSON.stringify(m.content).includes('ask_user_question'));
    await until(() => questionRow() !== undefined);

    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'switch to the cheaper plan',
    });
    expect(sent.status).toBeLessThan(300);
    const queued = w.s.db
      .select()
      .from(chiefMessage)
      .all()
      .find((m) => m.role === 'user' && JSON.stringify(m.content).includes('cheaper plan'));
    const steered = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/messages/${queued?.id}/steer`,
    );
    expect(steered.status).toBe(200);
    await until(() => w.s.db.select().from(step).all().length === 1);

    const answered = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${questionRow()?.id}/answer`,
      { answers: [{ header: 'Pick', choices: ['A'] }] },
    );
    expect(answered.status).toBe(200);
    await until(() => w.s.db.select().from(step).get()?.status === 'done');
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain('switch to the cheaper plan');
    expect(w.s.db.select().from(step).all()).toHaveLength(1);
  });
});
