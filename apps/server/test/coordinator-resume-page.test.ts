import { liveQuickReplies, QUICK_REPLIES_KIND, quickRepliesRowId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { chiefMessage, step } from '../src/db/schema.js';
import { newestMessagePage } from '../src/services/message-page.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

function seedResume(scopeProjectId: string | null = null) {
  H.s.db
    .insert(chiefMessage)
    .values([
      {
        id: 'owner',
        threadId: H.threadId,
        role: 'user',
        content: 'Fix the keyboard',
        createdAt: 100,
      },
      {
        id: 'user-failed-wake',
        threadId: H.threadId,
        role: 'user',
        content: '[wake:failed] provenance=watch:other\nCheck a failure',
        createdAt: 200,
      },
      {
        id: 'wake-reply',
        threadId: H.threadId,
        role: 'assistant',
        content: 'Checking the failure.',
        createdAt: 250,
      },
      {
        id: 'resumed-reply',
        threadId: H.threadId,
        role: 'assistant',
        content: 'Started task 169.',
        createdAt: 400,
      },
    ])
    .run();
  H.s.db
    .insert(step)
    .values({
      id: 'resumed',
      buildId: H.threadId,
      kind: 'chief',
      status: 'done',
      createdAt: 290,
      claimedAt: 300,
      prompt: 'The owner answered the parked question. Continue.',
      scopeProjectId,
    })
    .run();
}

const page = (before?: string, limit = 100) =>
  newestMessagePage(H.s.db, chiefMessage, H.threadId, { limit, before });
const boundaries = (messages: { id: string }[]) =>
  messages.filter((row) => row.id === 'user-resumed');

describe('Coordinator resume boundaries from the historical task 169 sequence', () => {
  test('a resumed owner reply after a wake is visible without rewriting the transcript', () => {
    seedResume();
    const before = H.s.db.select().from(chiefMessage).all();
    const result = page();
    expect(boundaries(result.messages)).toEqual([
      expect.objectContaining({ id: 'user-resumed', content: '' }),
    ]);
    expect(result.messages.find((row) => row.id === 'user-resumed')).toMatchObject({
      role: 'system',
      content: '',
      createdAt: 300,
    });
    expect(H.s.db.select().from(chiefMessage).all()).toEqual(before);
  });

  test.each(['coordinator', 'conversation'] as const)(
    '%s HTTP read restores the reply',
    async (surface) => {
      seedResume();
      const path =
        surface === 'coordinator'
          ? `/api/teams/${H.teamId}/coordinator`
          : `/api/conversations/${H.threadId}/messages`;
      const response = await req(H.s.app, 'GET', path);
      expect(response.status).toBe(200);
      const result = (await response.json()) as { messages: { id: string; content: unknown }[] };
      expect(boundaries(result.messages)).toEqual([
        expect.objectContaining({ id: 'user-resumed', content: '' }),
      ]);
    },
  );

  test('a claimed resume beyond the last persisted message projects its live boundary', () => {
    seedResume();
    H.s.db.delete(chiefMessage).where(eq(chiefMessage.id, 'resumed-reply')).run();
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, 'resumed')).run();
    expect(boundaries(page().messages)).toEqual([
      expect.objectContaining({ role: 'system', createdAt: 300, content: '' }),
    ]);
    expect(boundaries(page('wake-reply').messages)).toEqual([]);
  });

  test('a pure wake stays silent', () => {
    seedResume();
    H.s.db
      .update(step)
      .set({ prompt: '[wake:failed] provenance=watch:other\nCheck again' })
      .where(eq(step.id, 'resumed'))
      .run();
    expect(boundaries(page().messages)).toEqual([]);
  });

  test('existing daemon transcript boundaries are not duplicated', () => {
    seedResume();
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'user-resumed',
        threadId: H.threadId,
        role: 'user',
        content: 'Owner answer',
        createdAt: 300,
      })
      .run();
    expect(page().messages.filter((row) => row.id === 'user-resumed')).toHaveLength(1);
  });

  test('a daemon boundary used as the cursor is not synthesized into the older page', () => {
    seedResume();
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'user-resumed',
        threadId: H.threadId,
        role: 'user',
        content: 'Owner answer',
        createdAt: 300,
      })
      .run();
    expect(boundaries(page('user-resumed').messages)).toEqual([]);
  });

  test('unclaimed queued work does not make a wake reply visible', () => {
    seedResume();
    H.s.db
      .update(step)
      .set({ claimedAt: null, status: 'pending' })
      .where(eq(step.id, 'resumed'))
      .run();
    expect(boundaries(page().messages)).toEqual([]);
  });

  test('paging keeps a real oldest cursor and does not introduce boundaries outside the window', () => {
    seedResume();
    const newest = page(undefined, 2);
    expect(newest.messages[0]?.id).toBe('wake-reply');
    expect(newest.hasEarlier).toBe(true);
    const earlier = page(newest.messages[0]?.id, 2);
    expect(earlier.messages.map((row) => row.id)).toEqual(['owner', 'user-failed-wake']);
    expect(page(undefined, 1).messages.map((row) => row.id)).toEqual(['resumed-reply']);
  });

  test('a boundary in a gap between pages survives loading older history', () => {
    seedResume();
    const latest = page(undefined, 1);
    const older = page(latest.messages[0]?.id, 3);
    expect(boundaries([...older.messages, ...latest.messages])).toEqual([
      expect.objectContaining({ id: 'user-resumed', content: '' }),
    ]);
  });

  test('the prior wake reply stays before a same-millisecond resumed turn', () => {
    seedResume();
    H.s.db
      .update(chiefMessage)
      .set({ createdAt: 300 })
      .where(eq(chiefMessage.id, 'wake-reply'))
      .run();
    expect(page().messages.map((row) => row.id)).toEqual([
      'owner',
      'user-failed-wake',
      'wake-reply',
      'user-resumed',
      'resumed-reply',
    ]);
  });

  test('a same-millisecond reply follows its invisible turn boundary', () => {
    seedResume();
    H.s.db
      .update(chiefMessage)
      .set({ createdAt: 300 })
      .where(eq(chiefMessage.id, 'resumed-reply'))
      .run();
    const result = page();
    expect(boundaries(result.messages)).toEqual([
      expect.objectContaining({ id: 'user-resumed', content: '' }),
    ]);
    expect(result.messages.findIndex((row) => row.id === 'user-resumed')).toBeLessThan(
      result.messages.findIndex((row) => row.id === 'resumed-reply'),
    );
  });

  test('same-millisecond quick replies follow their invisible turn boundary', () => {
    seedResume();
    H.s.db
      .insert(chiefMessage)
      .values({
        id: quickRepliesRowId('resumed'),
        threadId: H.threadId,
        role: 'system',
        content: JSON.stringify({
          kind: QUICK_REPLIES_KIND,
          stepId: 'resumed',
          replies: ['Go on'],
        }),
        createdAt: 300,
      })
      .run();
    const result = page();
    expect(result.messages.map((row) => row.id)).toEqual([
      'owner',
      'user-failed-wake',
      'wake-reply',
      'user-resumed',
      quickRepliesRowId('resumed'),
      'resumed-reply',
    ]);
    expect(liveQuickReplies(result.messages, { running: false })).toEqual(['Go on']);
  });

  test('a different project step cannot reset a filtered conversation wake', () => {
    seedResume('other-project');
    H.s.db.update(chiefMessage).set({ projectId: H.projectId }).run();
    const result = newestMessagePage(
      H.s.db,
      chiefMessage,
      H.threadId,
      { limit: 100, projectId: H.projectId },
      eq(chiefMessage.projectId, H.projectId),
    );
    expect(boundaries(result.messages)).toEqual([]);
  });
});
