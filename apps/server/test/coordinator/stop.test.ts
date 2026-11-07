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

describe('Coordinator stop', () => {
  it('stops a turn that waits on a tool and issues no later request', async () => {
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

    const stopped = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/stop`,
    );
    expect(stopped.status).toBe(200);
    await until(() => w.s.db.select().from(step).get()?.status === 'stopped');
    await coordinator.idle();

    expect(requests).toBe(1);
    expect(w.s.db.select().from(step).get()?.status).toBe('stopped');
  });
});
