import { useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { THREAD_PARAM } from '../board/thread-copy.js';
import { useI18n } from '../i18n/provider.js';
import { ChiefQuestionCard, type QuestionPager, recommendedFirst } from './chief-question-card.js';
import { useOptionalChiefRoot } from './chief-root.js';
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

const DOCK_CLS = 'flex min-h-0 flex-col gap-1.5';

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

function DockQuestion({
  request,
  numberKeys,
  pager,
  bound,
}: {
  request: OriginChiefQuestion;
  numberKeys: boolean;
  pager: QuestionPager | undefined;
  bound: boolean;
}) {
  const root = useOptionalChiefRoot();
  const key = draftKeyOf(request);
  const error = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => questionSubmitStore.get(key).error,
    () => null,
  );
  return (
    <>
      {error !== null && (
        <p
          role="status"
          data-testid="chief-question-error"
          className="m-0 text-ui text-destructive"
        >
          {error}
        </p>
      )}
      <ChiefQuestionCard
        item={request.item}
        draftKey={key}
        numberKeys={numberKeys}
        {...(pager !== undefined ? { pager } : {})}
        bound={bound}
        onAnswer={(input) =>
          root?.surface.onAnswerQuestion?.({ ...input, threadId: request.conversationId })
        }
        onCancel={(requestId) =>
          root?.surface.onCancelQuestion?.(requestId, request.conversationId)
        }
      />
    </>
  );
}

function useShownQuestions(): OriginChiefQuestion[] {
  const root = useOptionalChiefRoot();
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  return (root?.pendingQuestions ?? []).filter(
    (request) => !questionDockState.isDismissing(request.item.requestId),
  );
}

export function useQuestionDockVisible(): boolean {
  return useShownQuestions().length > 0;
}

export function useAnswerKey(bound: boolean): string | null {
  const pending = useShownQuestions();
  const shown = pending[clampQuestionIndex(questionDockState.focus(), pending.length)];
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (shown === undefined ? -1 : stepOf(shown)),
    () => -1,
  );
  if (!bound || shown === undefined) return null;
  return answerKeyOf(draftKeyOf(shown), stepOf(shown));
}

export function ChiefQuestionDock({ home, bound }: { home: boolean; bound: boolean }) {
  const { t } = useI18n();
  const _root = useOptionalChiefRoot();
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
  return (
    <section
      data-testid="chief-question-dock"
      aria-label={t('待回答的提问')}
      className={`${DOCK_CLS} ${home ? 'mx-auto mt-2 w-[calc(100%-2rem)] max-w-182' : 'mx-4 mt-2'}`}
    >
      <DockQuestion
        key={shown.item.requestId}
        request={shown}
        numberKeys={numberKeys}
        pager={pager}
        bound={bound}
      />
    </section>
  );
}
