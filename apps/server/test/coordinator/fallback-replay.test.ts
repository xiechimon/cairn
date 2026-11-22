import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { chiefMessage, routingRule, step } from '../../src/db/schema.js';
import { req } from '../helpers.js';
import { boot, world } from './runner-world.js';

const QUOTA_ERROR = '402: {"message":"insufficient quota: usage limit reached"}';

test('a turn after a second fallback to the backup model still answers', async () => {
  const w = await world('turn 1');
  w.s.db
    .update(routingRule)
    .set({ fallbackModels: [{ provider: 'stub', modelId: 'b' }] })
    .where(eq(routingRule.id, 'rule-coordinator'))
    .run();
  const faux = fauxProvider({
    provider: 'stub',
    models: [
      { id: 'm', contextWindow: 200_000 },
      { id: 'b', contextWindow: 200_000 },
    ],
    tokensPerSecond: 1e9,
  });
  const fail = () => fauxAssistantMessage('', { stopReason: 'error', errorMessage: QUOTA_ERROR });
  faux.setResponses([
    fail,
    () => fauxAssistantMessage('backup one'),
    () => fauxAssistantMessage('primary two'),
    fail,
    () => fauxAssistantMessage('backup three'),
    () => fauxAssistantMessage('primary four'),
  ]);
  const errors: unknown[] = [];
  const coordinator = boot(w, faux, {
    logger: { info: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(args) },
  });
  const turn = async (content: string | null) => {
    if (content !== null) {
      const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
        content,
      });
      expect(sent.status).toBeLessThan(300);
    }
    for (let i = 0; i < 3; i++) {
      coordinator.wake(w.threadId);
      await coordinator.idle();
    }
  };
  await turn(null);
  await turn('turn 2');
  await turn('turn 3');
  await turn('turn 4');
  expect(
    w.s.db
      .select()
      .from(step)
      .all()
      .map((row) => [row.prompt, row.status]),
  ).toEqual([
    ['turn 1', 'done'],
    ['turn 2', 'done'],
    ['turn 3', 'done'],
    ['turn 4', 'done'],
  ]);
  const replies = w.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, w.threadId))
    .all()
    .filter((row) => row.role === 'assistant')
    .map((row) => JSON.stringify(row.content));
  for (const text of ['backup one', 'primary two', 'backup three', 'primary four'])
    expect(replies.join('\n')).toContain(text);
  expect(JSON.stringify(errors)).not.toContain('unknown ownership');
});
