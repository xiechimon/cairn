import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chiefMessage, coordinatorConversation, step } from '../../src/db/schema.js';
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

function questionRows(w: Awaited<ReturnType<typeof world>>) {
  return w.s.db
    .select()
    .from(chiefMessage)
    .all()
    .filter((m) => JSON.stringify(m.content).includes('ask_user_question'));
}

describe('Coordinator reconcile at open', () => {
  it('does not rerun a stopped step on reopen and gives the next step its own tool rows', async () => {
    const w = await world('first');
    const { faux } = stub('unused');
    let calls = 0;
    faux.setResponses([
      () => {
        calls++;
        return fauxAssistantMessage([fauxToolCall('ask_user', QUESTION)], {
          stopReason: 'toolUse',
        });
      },
      () => {
        calls++;
        return fauxAssistantMessage('second turn done');
      },
      () => {
        calls++;
        return fauxAssistantMessage('unexpected third request');
      },
    ]);
    const first = boot(w, faux);
    first.wake(w.threadId);
    await until(() => questionRows(w).length === 1);
    await first.close();
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('claimed');

    w.s.db.update(step).set({ status: 'stopped' }).where(eq(step.id, w.stepId)).run();
    const again = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'second',
    });
    expect(again.status).toBeLessThan(300);
    const second = boot(w, faux);
    second.wake(w.threadId);
    await second.idle();

    const rows = w.s.db.select().from(step).all();
    expect(rows.map((r) => r.status).sort()).toEqual(['done', 'stopped']);
    expect(calls).toBe(2);
    expect(questionRows(w)).toHaveLength(1);
    const text = JSON.stringify(
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content),
    );
    expect(text).toContain('second turn done');
  });

  it('resumes a claimed step once after a restart', async () => {
    const w = await world('resume me');
    const { faux } = stub('unused');
    let calls = 0;
    faux.setResponses([
      () => {
        calls++;
        return fauxAssistantMessage([fauxToolCall('ask_user', QUESTION)], {
          stopReason: 'toolUse',
        });
      },
      () => {
        calls++;
        return fauxAssistantMessage('resumed answer');
      },
    ]);
    const first = boot(w, faux);
    first.wake(w.threadId);
    await until(() => questionRows(w).length === 1);
    await first.close();

    const second = boot(w, faux);
    second.wake(w.threadId);
    await new Promise((r) => setTimeout(r, 300));
    const question = questionRows(w)[0];
    const requestId = question?.id;
    const answered = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${requestId}/answer`,
      { answers: [{ header: 'Pick', choices: ['A'] }] },
    );
    expect(answered.status).toBe(200);
    await until(() => w.s.db.select().from(step).get()?.status === 'done');
    await second.idle();

    expect(calls).toBe(2);
    expect(questionRows(w)).toHaveLength(1);
    expect(JSON.stringify(w.s.db.select().from(chiefMessage).all())).toContain('resumed answer');
  });

  it('recovers proven mirror debt before deciding that the store is ahead of the restored database', async () => {
    const w = await world('before the restore');
    const { faux } = stub('ok');
    const first = boot(w, faux);
    first.wake(w.threadId);
    await first.idle();
    await first.close();
    w.s.db.update(coordinatorConversation).set({ lastMirroredEntryId: '1' }).run();
    await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'after the restore',
    });

    const outcomes: string[] = [];
    const second = boot(w, faux, {
      logger: {
        info: (obj: { outcome?: string }) => {
          if (obj.outcome !== undefined) outcomes.push(obj.outcome);
        },
        warn: () => {},
        error: () => {},
      },
    });
    second.wake(w.threadId);
    await second.idle();

    expect(outcomes).toEqual(['unchanged']);
  });

  it('re-seeds a newly claimed step when the store is behind the mirrored watermark', async () => {
    const w = await world('before the old backup');
    const { faux } = stub('ok');
    const first = boot(w, faux);
    first.wake(w.threadId);
    await first.idle();
    await first.close();
    w.s.db.update(coordinatorConversation).set({ lastMirroredEntryId: '9999' }).run();
    await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'after the old backup',
    });

    const outcomes: string[] = [];
    const second = boot(w, faux, {
      logger: {
        info: (obj: { outcome?: string }) => {
          if (obj.outcome !== undefined) outcomes.push(obj.outcome);
        },
        warn: () => {},
        error: () => {},
      },
    });
    second.wake(w.threadId);
    await second.idle();

    expect(outcomes).toEqual(['reseeded-behind']);
  });
});
