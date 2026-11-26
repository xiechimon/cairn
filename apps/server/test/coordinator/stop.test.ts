import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import {
  chiefMessage,
  coordinatorConversation,
  coordinatorInput,
  step,
} from '../../src/db/schema.js';
import { stoppedCoordinatorTurns } from '../../src/services/coordinator-inputs.js';
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

interface Asked {
  role: string;
  text: string;
}

function conversation(messages: { role: string; content: unknown }[]): Asked[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      text:
        typeof m.content === 'string'
          ? m.content
          : (m.content as { text?: string }[]).map((block) => block.text ?? '').join(''),
    }));
}

function expectCancelledBetween(asked: Asked[], stopped: string, next: string): void {
  const from = asked.findIndex((m) => m.role === 'user' && m.text.includes(stopped));
  const to = asked.findIndex((m) => m.role === 'user' && m.text.includes(next));
  expect(from, `the model still sees what was stopped: ${stopped}`).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  const note = asked
    .slice(from + 1, to)
    .find((m) => m.role === 'assistant' && m.text.includes('[Stopped]'))?.text;
  expect(
    note,
    'the model is told the stopped request is cancelled before it reads the next one',
  ).toContain('is cancelled');
  expect(note, 'the note names the request it cancels').toContain(stopped);
}

describe('which Coordinator requests a stop cancels', () => {
  it('lists every attempt of the turns stopped since the last turn that succeeded', async () => {
    const w = await world('long job');
    const turn = (id: string, status: 'stopped' | 'done' | 'failed', finishedAt: number) =>
      w.s.db
        .insert(step)
        .values({ id, buildId: w.threadId, kind: 'chief', status, createdAt: 1, finishedAt })
        .run();
    turn('stopped-long-ago', 'stopped', 100);
    turn('answered', 'done', 200);
    turn('failed-alone', 'failed', 300);
    turn('stopped-on-retry', 'stopped', 400);
    w.s.db
      .insert(coordinatorInput)
      .values({
        id: 'stopped-on-retry',
        threadId: w.threadId,
        stepId: 'stopped-on-retry',
        kind: 'initial',
        ownerMessageIds: [],
        content: 'long job',
        attempt: 2,
        createdAt: 1,
      })
      .run();

    expect(stoppedCoordinatorTurns(w.s.db, w.threadId)).toEqual([
      { stepId: 'stopped-on-retry', requestIds: ['stopped-on-retry', 'stopped-on-retry#2'] },
    ]);
  });
});

describe('Coordinator stop', () => {
  it.each(['kept', 'lost'])(
    'tells the next turns that a stopped request is cancelled, also after a restart with the store %s',
    async (store) => {
      const w = await world('write a long article about cairns');
      const faux = fauxProvider({
        provider: 'stub',
        models: [{ id: 'm', contextWindow: 200_000 }],
        tokensPerSecond: 40,
      });
      const requests: Asked[][] = [];
      faux.setResponses(
        Array(8).fill((c: { messages: { role: string; content: unknown }[] }) => {
          requests.push(conversation(c.messages));
          return fauxAssistantMessage(
            requests.length === 1 ? `article ${'stone '.repeat(400)}` : 'ok',
          );
        }),
      );
      const first = boot(w, faux);
      first.wake(w.threadId);
      await until(() => requests.length === 1);
      await new Promise((r) => setTimeout(r, 300));
      const stopped = await req(
        w.s.app,
        'POST',
        `/api/teams/${w.teamId}/chief/threads/${w.threadId}/stop`,
      );
      expect(stopped.status).toBe(200);
      await until(() => w.s.db.select().from(step).get()?.status === 'stopped');
      await first.idle();

      const send = async (coordinator: typeof first, content: string, done: number) => {
        const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
          content,
        });
        expect(sent.status).toBeLessThan(300);
        coordinator.wake(w.threadId);
        await until(
          () =>
            w.s.db
              .select()
              .from(step)
              .all()
              .filter((row) => row.status === 'done').length === done,
        );
        await coordinator.idle();
      };
      await send(first, 'what time is it', 1);
      expectCancelledBetween(requests.at(-1) ?? [], 'long article', 'what time is it');

      await first.close();
      const storeId = () => w.s.db.select().from(coordinatorConversation).get()?.storeId;
      const storeBefore = storeId();
      const storageDir = store === 'kept' ? w.storageDir : makeTestTempDir('coord-lost-');
      const second = boot({ ...w, storageDir }, faux);
      await send(second, 'and the date', 2);
      expect(storeId() === storeBefore, 'the restart reused the store').toBe(store === 'kept');
      expectCancelledBetween(requests.at(-1) ?? [], 'long article', 'what time is it');
      expect(
        JSON.stringify(w.s.db.select().from(chiefMessage).all()),
        'the note is for the model, never a chat bubble',
      ).not.toContain('[Stopped]');
      expect(
        requests.at(-1)?.filter((m) => m.text.includes('[Stopped]')),
        'one stop is noted once',
      ).toHaveLength(1);
      if (store === 'lost') {
        await second.close();
        releaseTestTempDir(storageDir);
      }
    },
    30_000,
  );

  it('cancels a stopped request whose executor went away before it could end the turn', async () => {
    const w = await world('delete every branch');
    const { faux } = stub('unused');
    const requests: Asked[][] = [];
    faux.setResponses([
      (c: { messages: { role: string; content: unknown }[] }) => {
        requests.push(conversation(c.messages));
        return fauxAssistantMessage([fauxToolCall('ask_user', QUESTION)], {
          stopReason: 'toolUse',
        });
      },
      ...Array(4).fill((c: { messages: { role: string; content: unknown }[] }) => {
        requests.push(conversation(c.messages));
        return fauxAssistantMessage('ok');
      }),
    ]);
    const first = boot(w, faux);
    first.wake(w.threadId);
    await until(() =>
      w.s.db
        .select()
        .from(chiefMessage)
        .all()
        .some((m) => JSON.stringify(m.content).includes('ask_user_question')),
    );
    await first.close();
    w.s.db.update(step).set({ status: 'stopped' }).where(eq(step.id, w.stepId)).run();

    const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'list the branches',
    });
    expect(sent.status).toBeLessThan(300);
    const second = boot(w, faux);
    second.wake(w.threadId);
    await until(() =>
      w.s.db
        .select()
        .from(step)
        .all()
        .some((row) => row.status === 'done'),
    );
    await second.idle();
    expectCancelledBetween(requests.at(-1) ?? [], 'delete every branch', 'list the branches');
  }, 30_000);

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
