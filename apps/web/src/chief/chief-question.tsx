import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { THREAD_PARAM } from '../board/thread-copy.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { useI18n } from '../i18n/provider.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { QuestionChips, type QuestionPager, recommendedFirst } from './question-chips.js';
import { clampQuestionIndex } from './question-dock-index.js';
import { answerKeyOf, questionDockState } from './question-dock-state.js';
import {
  emptyQuestionDrafts,
  questionDraftComplete,
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

function setStepOf(request: OriginChiefQuestion, step: number): void {
  const key = draftKeyOf(request);
  const record = questionDraftStore.get(key) ?? {
    drafts: emptyQuestionDrafts(request.item.questions),
    step: 0,
  };
  questionDraftStore.set(key, { ...record, step });
}

function stepComplete(request: OriginChiefQuestion, typed: boolean): boolean {
  if (typed) return true;
  const record = questionDraftStore.get(draftKeyOf(request));
  const questions = request.item.questions.map(recommendedFirst);
  const step = record?.step ?? 0;
  return questionDraftComplete(record?.drafts[step], questions[step]);
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

export function useAnswerKey(): string | null {
  const pending = useShownQuestions();
  const shown = pending[clampQuestionIndex(questionDockState.focus(), pending.length)];
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (shown === undefined ? -1 : stepOf(shown)),
    () => -1,
  );
  if (shown === undefined) return null;
  return answerKeyOf(draftKeyOf(shown), stepOf(shown));
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
      className="m-0 mt-1 text-meta text-destructive"
    >
      {error}
    </p>
  );
}

export function ChiefQuestion({ bound }: { bound: boolean }) {
  const { t } = useI18n();
  const root = useOptionalChiefRoot();
  const [searchParams] = useSearchParams();
  const numberKeys = bound && searchParams.get(THREAD_PARAM) === null;
  const pending = useShownQuestions();
  const setIndex = questionDockState.setFocus;
  const index = questionDockState.focus();
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => pending.map((request) => `${stepOf(request)}:${stepComplete(request, false)}`).join(','),
    () => '',
  );
  const reveals = questionDockState.reveals();
  const itemRef = useRef<HTMLDivElement | null>(null);
  const revealedRef = useRef(reveals);
  useEffect(() => {
    if (revealedRef.current === reveals) return;
    revealedRef.current = reveals;
    itemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [reveals]);
  const at = clampQuestionIndex(index, pending.length);
  const shown = pending[at];
  if (shown === undefined) return null;
  const counts = pending.map((request) => request.item.questions.length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const step = stepOf(shown);
  const position = counts.slice(0, at).reduce((sum, count) => sum + count, 0) + step + 1;
  const lastStep = (counts[at] ?? 1) - 1;
  const previous = pending[at - 1];
  const next = pending[at + 1];
  const pager: QuestionPager | undefined =
    total > 1
      ? {
          label: t('{n} / {total}', { n: position, total }),
          canPrev:
            !(bound && questionDockState.uploading()) && (step > 0 || previous !== undefined),
          canNext:
            !(bound && questionDockState.uploading()) &&
            (step < lastStep
              ? stepComplete(
                  shown,
                  questionDockState.answerText(answerKeyOf(draftKeyOf(shown), step)).trim() !== '',
                )
              : next !== undefined),
          onPrev: () => {
            if (step > 0) {
              setStepOf(shown, step - 1);
              return;
            }
            if (previous === undefined) return;
            setStepOf(previous, previous.item.questions.length - 1);
            setIndex(at - 1);
          },
          onNext: () => {
            if (step < lastStep) {
              setStepOf(shown, step + 1);
              return;
            }
            if (next === undefined) return;
            setStepOf(next, 0);
            setIndex(at + 1);
          },
        }
      : undefined;
  const key = draftKeyOf(shown);
  return (
    <MessageScrollerItem>
      <section
        ref={itemRef}
        data-testid="chief-question"
        aria-label={t('待回答的提问')}
        className="mt-5"
      >
        <QuestionChips
          key={shown.item.requestId}
          item={shown.item}
          draftKey={key}
          numberKeys={numberKeys}
          {...(pager !== undefined ? { pager } : {})}
          bound={bound}
          onAnswer={(input) =>
            root?.surface.onAnswerQuestion?.({ ...input, threadId: shown.conversationId })
          }
          onCancel={(requestId) =>
            root?.surface.onCancelQuestion?.(requestId, shown.conversationId)
          }
        />
        <QuestionError draftKey={key} />
      </section>
    </MessageScrollerItem>
  );
}
