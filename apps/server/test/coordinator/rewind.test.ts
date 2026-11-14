import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SUGGEST_REPLIES_ASK } from '../../src/coordinator/runtime/suggest-replies.js';
import { chiefMessage, coordinatorConversation, coordinatorEntry } from '../../src/db/schema.js';
import { req } from '../helpers.js';
import { boot, stub, type World, world } from './runner-world.js';

type Seen = { messages: unknown[] }[];

function answers(faux: ReturnType<typeof stub>['faux'], texts: string[], seen: Seen) {
  let next = 0;
  faux.setResponses(
    Array(texts.length * 2).fill((context: { messages: { content: unknown }[] }) => {
      if (context.messages[0]?.content === SUGGEST_REPLIES_ASK)
        return fauxAssistantMessage('{"replies":[]}');
      seen.push({ messages: context.messages });
      return fauxAssistantMessage(texts[next++] ?? '');
    }),
  );
}

async function say(w: World, coordinator: ReturnType<typeof boot>, content: string) {
  const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, { content });
  expect(sent.status).toBeLessThan(300);
  coordinator.wake(w.threadId);
  await coordinator.idle();
}

async function rewindTo(w: World, content: string) {
  const anchor = w.s.db
    .select()
    .from(chiefMessage)
    .orderBy(asc(chiefMessage.createdAt))
    .all()
    .find((m) => m.role === 'user' && JSON.stringify(m.content).includes(content));
  const rewound = await req(
    w.s.app,
    'POST',
    `/api/teams/${w.teamId}/chief/threads/${w.threadId}/rewind`,
    { messageId: anchor?.id },
  );
  expect(rewound.status).toBe(200);
}

describe('Coordinator rewind', () => {
  it('forks the store at the anchor so the next request carries no later turn', async () => {
    const w = await world('first question');
    const { faux } = stub('unused');
    const seen: Seen = [];
    answers(faux, ['alpha answer', 'beta answer', 'gamma answer', 'delta answer'], seen);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    await say(w, coordinator, 'second question');
    await say(w, coordinator, 'third question');
    expect(seen).toHaveLength(3);
    const before = w.s.db.select().from(coordinatorConversation).get();
    const newestMapped = Math.max(
      ...w.s.db
        .select()
        .from(coordinatorEntry)
        .all()
        .map((e) => Number(e.entryId)),
    );
    expect(Number(before?.lastMirroredEntryId)).toBe(newestMapped);

    await rewindTo(w, 'second question');
    expect(w.s.db.select().from(coordinatorConversation).get()?.lastMirroredEntryId).toMatch(
      /^rewind:\d+:/,
    );
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(seen).toHaveLength(4);
    const next = JSON.stringify(seen[3]?.messages);
    expect(next).toContain('first question');
    expect(next).toContain('alpha answer');
    expect(next).toContain('second question');
    expect(next).not.toContain('beta answer');
    expect(next).not.toContain('third question');
    expect(next).not.toContain('gamma answer');
    const after = w.s.db.select().from(coordinatorConversation).get();
    expect(after?.conversationId).not.toBe(before?.conversationId);
    expect(after?.lastMirroredEntryId).toMatch(/^\d+$/);
  });

  it('keeps the rewound view after the server restarts', async () => {
    const w = await world('first question');
    const { faux } = stub('unused');
    const seen: Seen = [];
    answers(faux, ['alpha answer', 'beta answer', 'gamma answer', 'delta answer', 'eps'], seen);
    const first = boot(w, faux);
    first.wake(w.threadId);
    await first.idle();
    await say(w, first, 'second question');
    await say(w, first, 'third question');
    await rewindTo(w, 'second question');
    first.wake(w.threadId);
    await first.idle();
    await first.close();

    const again = boot(w, faux);
    await say(w, again, 'after restart');

    expect(seen).toHaveLength(5);
    const last = JSON.stringify(seen[4]?.messages);
    expect(last).toContain('delta answer');
    expect(last).toContain('after restart');
    expect(last).not.toContain('beta answer');
    expect(last).not.toContain('third question');
  });

  it('reseeds from the thread rows when the anchor opens the conversation', async () => {
    const w = await world('first question');
    const { faux } = stub('unused');
    const seen: Seen = [];
    answers(faux, ['alpha answer', 'beta answer', 'gamma answer'], seen);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();
    await say(w, coordinator, 'second question');

    await rewindTo(w, 'first question');
    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(seen).toHaveLength(3);
    const next = JSON.stringify(seen[2]?.messages);
    expect(next.split('first question')).toHaveLength(2);
    expect(next).not.toContain('beta answer');
    expect(next).not.toContain('second question');
    expect(w.s.db.select().from(coordinatorConversation).get()?.lastMirroredEntryId).toMatch(
      /^\d+$/,
    );
  });
});
