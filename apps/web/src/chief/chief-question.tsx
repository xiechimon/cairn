import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import { useArrivals } from '../components/growth.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { QuestionReceipt } from './question-answered-line.js';
import { QuestionCard } from './question-card.js';
import { questionDraftKey, questionDraftStore, questionSubmitStore } from './question-drafts.js';
import type { ChiefQuestionItem } from './question-item.js';
import type { OriginChiefQuestion } from './question-origin.js';
import { questionState } from './question-state.js';

function draftKeyOf(request: OriginChiefQuestion): string {
  return questionDraftKey({
    teamId: request.teamId,
    conversationId: request.conversationId,
    requestId: request.item.requestId,
  });
}

export const QuestionScopeContext = createContext<ReadonlySet<string> | null>(null);

const ArrivedQuestionsContext = createContext<ReadonlySet<string>>(new Set());

export function QuestionArrivals({ children }: { children: ReactNode }) {
  const root = useOptionalChiefRoot();
  const arrived = useArrivals(
    (root?.pendingQuestions ?? []).map((request) => request.item.requestId),
    root?.surface.load === 'ready',
  );
  return (
    <ArrivedQuestionsContext.Provider value={arrived}>{children}</ArrivedQuestionsContext.Provider>
  );
}

function useShownQuestions(): OriginChiefQuestion[] {
  const root = useOptionalChiefRoot();
  const scope = useContext(QuestionScopeContext);
  useSyncExternalStore(questionState.subscribe, questionState.snapshot, () => 0);
  return (root?.pendingQuestions ?? []).filter(
    (request) =>
      (scope === null || scope.has(request.item.requestId)) &&
      !questionState.isDismissing(request.item.requestId),
  );
}

export function useQuestionPending(): boolean {
  return useShownQuestions().length > 0;
}

function QuestionError({ draftKey }: { draftKey: string }) {
  const error = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => questionSubmitStore.get(draftKey).error,
    () => null,
  );
  if (error === null) return null;
  return (
    <p
      role="status"
      data-testid="chief-question-error"
      className="m-0 px-4 pb-3 text-meta text-destructive"
    >
      {error}
    </p>
  );
}

export function PendingQuestion({ item }: { item: ChiefQuestionItem }) {
  const root = useOptionalChiefRoot();
  const shown = useShownQuestions();
  const arrived = useContext(ArrivedQuestionsContext);
  if (questionState.isDismissing(item.requestId))
    return <QuestionReceipt item={{ ...item, status: 'cancelled' }} />;
  const request = shown.find((candidate) => candidate.item.requestId === item.requestId);
  if (request === undefined) return <QuestionCard item={item} />;
  const key = draftKeyOf(request);
  return (
    <QuestionCard
      item={request.item}
      draftKey={key}
      enter={arrived.has(item.requestId)}
      onAnswer={(input) =>
        root?.surface.onAnswerQuestion?.({ ...input, threadId: request.conversationId })
      }
      onCancel={(requestId) => root?.surface.onCancelQuestion?.(requestId, request.conversationId)}
      footer={<QuestionError draftKey={key} />}
    />
  );
}
