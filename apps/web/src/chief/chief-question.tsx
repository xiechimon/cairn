import { createContext, useContext, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { THREAD_PARAM } from '../board/thread-copy.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { useI18n } from '../i18n/provider.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { QuestionChips } from './question-chips.js';
import { clampQuestionIndex } from './question-dock-index.js';
import { answerKeyOf, questionDockState } from './question-dock-state.js';
import { questionDraftKey, questionDraftStore, questionSubmitStore } from './question-drafts.js';
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
  const index = questionDockState.focus();
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => pending.map(stepOf).join(','),
    () => '',
  );
  const reveals = questionDockState.reveals();
  const itemRef = useRef<HTMLDivElement | null>(null);
  const headerId = useId();
  const revealedRef = useRef(reveals);
  useEffect(() => {
    if (revealedRef.current === reveals) return;
    revealedRef.current = reveals;
    itemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [reveals]);
  const at = clampQuestionIndex(index, pending.length);
  const shown = pending[at];
  if (shown === undefined) return null;
  const step = stepOf(shown);
  const key = draftKeyOf(shown);
  const header = shown.item.questions[step]?.header ?? '';
  return (
    <MessageScrollerItem>
      <section
        ref={itemRef}
        data-testid="chief-question"
        aria-label={t('待回答的提问')}
        aria-describedby={header === '' ? undefined : headerId}
        className="mt-5"
      >
        {header !== '' && (
          <span id={headerId} hidden>
            {header}
          </span>
        )}
        <QuestionChips
          key={shown.item.requestId}
          item={shown.item}
          draftKey={key}
          numberKeys={numberKeys}
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
