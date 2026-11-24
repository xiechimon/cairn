import { createContext, useContext, useSyncExternalStore } from 'react';
import { useArrivals } from '../components/growth.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { DecisionDock, type DockPager } from './decision-dock.js';
import { clampQuestionIndex } from './question-dock-index.js';
import { answerKeyOf, questionDockState } from './question-dock-state.js';
import {
  emptyQuestionDrafts,
  questionDraftKey,
  questionDraftStore,
  questionSubmitStore,
} from './question-drafts.js';
import type { OriginChiefQuestion } from './question-origin.js';

function draftKeyOf(request: OriginChiefQuestion): string {
  return questionDraftKey({
    teamId: request.teamId,
    conversationId: request.conversationId,
    requestId: request.item.requestId,
  });
}

function stepOf(request: OriginChiefQuestion): number {
  return questionDraftStore.get(draftKeyOf(request))?.step ?? 0;
}

function goToStep(request: OriginChiefQuestion, step: number): void {
  const key = draftKeyOf(request);
  const drafts = questionDraftStore.get(key)?.drafts ?? emptyQuestionDrafts(request.item.questions);
  questionDraftStore.set(key, { drafts, step });
}

export const QuestionScopeContext = createContext<ReadonlySet<string> | null>(null);

function useShownQuestions(): OriginChiefQuestion[] {
  const root = useOptionalChiefRoot();
  const scope = useContext(QuestionScopeContext);
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  return (root?.pendingQuestions ?? []).filter(
    (request) =>
      (scope === null || scope.has(request.item.requestId)) &&
      !questionDockState.isDismissing(request.item.requestId),
  );
}

export function useQuestionPending(): boolean {
  return useShownQuestions().length > 0;
}

function useShownQuestion(): OriginChiefQuestion | undefined {
  const pending = useShownQuestions();
  const shown = pending[clampQuestionIndex(questionDockState.focus(), pending.length)];
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (shown === undefined ? -1 : stepOf(shown)),
    () => -1,
  );
  return shown;
}

export function useAnswerKey(): string | null {
  const shown = useShownQuestion();
  if (shown === undefined) return null;
  return answerKeyOf(draftKeyOf(shown), stepOf(shown));
}

export function useMinimizedQuestion(): string | null {
  const shown = useShownQuestion();
  if (shown === undefined || !questionDockState.minimized()) return null;
  return shown.item.questions[stepOf(shown)]?.question ?? null;
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

function pagerOf(pending: OriginChiefQuestion[], at: number): DockPager {
  const sizes = pending.map((request) => request.item.questions.length);
  const before = sizes.slice(0, at).reduce((sum, n) => sum + n, 0);
  const shown = pending[at];
  const step = shown === undefined ? 0 : stepOf(shown);
  const move = (delta: -1 | 1) => {
    if (shown === undefined) return;
    const next = step + delta;
    if (next >= 0 && next < shown.item.questions.length) {
      goToStep(shown, next);
      return;
    }
    const neighbour = pending[at + delta];
    if (neighbour === undefined) return;
    goToStep(neighbour, delta === 1 ? 0 : neighbour.item.questions.length - 1);
    questionDockState.setFocus(at + delta);
  };
  return {
    at: before + step,
    total: sizes.reduce((sum, n) => sum + n, 0),
    onPrev: () => move(-1),
    onNext: () => move(1),
  };
}

export function ChiefQuestion() {
  const root = useOptionalChiefRoot();
  const pending = useShownQuestions();
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => pending.map(stepOf).join(','),
    () => '',
  );
  const arrived = useArrivals(
    pending.map((request) => request.item.requestId),
    root?.surface.load === 'ready',
  );
  const at = clampQuestionIndex(questionDockState.focus(), pending.length);
  const shown = pending[at];
  if (shown === undefined || questionDockState.minimized()) return null;
  const key = draftKeyOf(shown);
  return (
    <div
      data-testid="chief-question-dock"
      className="mx-auto mb-2 flex min-h-0 w-[calc(100%-2rem)] max-w-chat flex-col"
    >
      <DecisionDock
        key={shown.item.requestId}
        item={shown.item}
        draftKey={key}
        bound
        enter={arrived.has(shown.item.requestId)}
        pager={pagerOf(pending, at)}
        onMinimize={() => questionDockState.minimize()}
        onAnswer={(input) =>
          root?.surface.onAnswerQuestion?.({ ...input, threadId: shown.conversationId })
        }
        onCancel={(requestId) => root?.surface.onCancelQuestion?.(requestId, shown.conversationId)}
        footer={<QuestionError draftKey={key} />}
      />
    </div>
  );
}
