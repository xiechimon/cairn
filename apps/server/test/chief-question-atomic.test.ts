import { and, eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { chiefMessage, notification } from '../src/db/schema.js';
import { createOrGetQuestion } from '../src/services/chief-questions.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

const QUESTIONS = [{ header: 'Next', question: 'Retry or switch machine?', options: [] }];

function deps() {
  return { db: H.s.db, hub: H.s.hub, convHub: H.s.convHub, user: H.s.user };
}

function questionRows() {
  return H.s.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, 'req-1'), eq(chiefMessage.threadId, H.threadId)))
    .all();
}

function notifications() {
  return H.s.db.select().from(notification).where(eq(notification.userId, H.userId)).all();
}

describe('ask_user commits the question card with its notification', () => {
  test('a failure while notifying leaves no un-notified question behind', () => {
    vi.spyOn(H.s.hub, 'publishNotification').mockImplementationOnce(() => {
      throw new Error('killed between decision and act');
    });
    expect(() =>
      createOrGetQuestion(deps(), {
        threadId: H.threadId,
        requestId: 'req-1',
        questions: QUESTIONS,
      }),
    ).toThrow('killed between decision and act');
    expect(questionRows()).toHaveLength(0);
    expect(notifications()).toHaveLength(0);
  });

  test('the retry after that failure creates the question and notifies once', () => {
    vi.spyOn(H.s.hub, 'publishNotification').mockImplementationOnce(() => {
      throw new Error('killed between decision and act');
    });
    expect(() =>
      createOrGetQuestion(deps(), {
        threadId: H.threadId,
        requestId: 'req-1',
        questions: QUESTIONS,
      }),
    ).toThrow();
    const retry = createOrGetQuestion(deps(), {
      threadId: H.threadId,
      requestId: 'req-1',
      questions: QUESTIONS,
    });
    expect(retry.created).toBe(true);
    expect(questionRows()).toHaveLength(1);
    expect(notifications()).toHaveLength(1);
  });

  test('a repeat after success returns the same question and does not notify again', () => {
    createOrGetQuestion(deps(), { threadId: H.threadId, requestId: 'req-1', questions: QUESTIONS });
    const publish = vi.spyOn(H.s.hub, 'publishNotification');
    const again = createOrGetQuestion(deps(), {
      threadId: H.threadId,
      requestId: 'req-1',
      questions: QUESTIONS,
    });
    expect(again.created).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(1);
  });
});
