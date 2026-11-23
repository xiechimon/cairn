import type { AskUserQuestion } from '@cairn/shared';
import type { step } from '../../db/schema.js';

export type ImStepRow = typeof step.$inferSelect;

export interface ImRuntimeHooks {
  assertQuestionFits(
    threadId: string,
    requestId: string,
    questions: readonly AskUserQuestion[],
  ): void;
  notice(threadId: string, text: string, card?: { requestId: string }): void;
  turnFinished(stepRow: ImStepRow): void;
}

let current: ImRuntimeHooks | null = null;

export function setImRuntime(hooks: ImRuntimeHooks | null): void {
  current = hooks;
}

export function assertImQuestionFits(
  threadId: string,
  requestId: string,
  questions: readonly AskUserQuestion[],
): void {
  current?.assertQuestionFits(threadId, requestId, questions);
}

export function imNotice(threadId: string, text: string, card?: { requestId: string }): void {
  current?.notice(threadId, text, card);
}

export function imTurnFinished(stepRow: ImStepRow): void {
  current?.turnFinished(stepRow);
}
