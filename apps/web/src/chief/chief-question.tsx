import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { useArrivals } from '../components/growth.js';
import { useI18n } from '../i18n/provider.js';
import { approvalCardOf, isApprovalRequest } from './approval-card-model.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { DecisionDock, type DockPager } from './decision-dock.js';
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
  const { t } = useI18n();
  const shown = useShownQuestion();
  if (shown === undefined || !questionDockState.minimized()) return null;
  const current = shown.item.questions[stepOf(shown)] ?? shown.item.questions[0];
  if (current === undefined) return null;
  return isApprovalRequest(shown.item.requestId)
    ? approvalCardOf(current, t).title
    : current.question;
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
    () =>
      pending
        .map((r) => `${stepOf(r)}:${questionSubmitStore.get(draftKeyOf(r)).submitting}`)
        .join(','),
    () => '',
  );
  const arrived = useArrivals(
    pending.map((request) => request.item.requestId),
    root?.surface.load === 'ready',
  );
  const at = clampQuestionIndex(questionDockState.focus(), pending.length);
  const shown = pending[at];
  const minimized = questionDockState.minimized();
  useSyncExternalStore(
    questionDockState.subscribe,
    () =>
      shown === undefined
        ? ''
        : questionDockState.answerText(answerKeyOf(draftKeyOf(shown), stepOf(shown))),
    () => '',
  );
  const submitRef = useRef<() => void>(() => {});
  const minimizedSubmitState = (() => {
    if (
      !minimized ||
      shown === undefined ||
      shown.item.status !== 'pending' ||
      root?.surface.onAnswerQuestion === undefined
    )
      return null;
    const key = draftKeyOf(shown);
    const step = stepOf(shown);
    const questions = shown.item.questions;
    const stored = questionDraftStore.get(key)?.drafts;
    const drafts =
      stored !== undefined && stored.length === questions.length
        ? stored
        : emptyQuestionDrafts(questions);
    const effective = drafts.map((d, i) => {
      const prompt = questions[i];
      const text = questionDockState.answerText(answerKeyOf(key, i));
      if (prompt === undefined || text.trim() === '') return d;
      if (d.kind === 'text') return { kind: 'text' as const, value: text };
      if (prompt.multiSelect === true) return { ...d, other: true, otherText: text };
      return { kind: 'choices' as const, picked: [], other: true, otherText: text };
    });
    const uploading = questionDockState.uploading();
    const submitting = questionSubmitStore.get(key).submitting;
    const last = step === questions.length - 1;
    const stepOk = questionDraftComplete(effective[step], questions[step]);
    const allOk = questions.every((q, i) => questionDraftComplete(effective[i], q));
    submitRef.current = () => {
      if (submitting || uploading || !stepOk) return;
      if (!allOk) {
        const open = questions.findIndex((q, i) => !questionDraftComplete(effective[i], q));
        if (open >= 0) {
          questionDraftStore.set(key, { drafts: effective, step: open });
          questionDockState.reveal();
        }
        return;
      }
      root.surface.onAnswerQuestion?.({
        requestId: shown.item.requestId,
        threadId: shown.conversationId,
        answers: effective.map((d, i) => {
          const header = questions[i]?.header ?? '';
          if (d.kind === 'text') return { header, text: d.value.trim() };
          const choices = [...d.picked];
          if (d.other && d.otherText.trim() !== '') choices.push(d.otherText.trim());
          return { header, choices };
        }),
      });
    };
    return {
      requestId: shown.item.requestId,
      last,
      enabled: !submitting && !uploading && stepOk,
    };
  })();
  useEffect(() => {
    if (minimizedSubmitState === null) return;
    questionDockState.setPrimary({
      ...minimizedSubmitState,
      advance: () => submitRef.current(),
    });
    const id = minimizedSubmitState.requestId;
    return () => questionDockState.clearPrimary(id);
  }, [minimizedSubmitState?.requestId, minimizedSubmitState?.last, minimizedSubmitState?.enabled]);
  if (shown === undefined || minimized) return null;
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
