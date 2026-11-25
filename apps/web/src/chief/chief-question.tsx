import { ChevronUp } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { useArrivals } from '../components/growth.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { isApprovalRequest } from './approval-card-model.js';
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

const useSyncScopeEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

function plainQuestionLine(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function useQuestionScopeKey(pending: readonly OriginChiefQuestion[]): string {
  const root = useOptionalChiefRoot();
  const scope = useContext(QuestionScopeContext);
  const base = root?.surface.chiefData.threadId ?? pending[0]?.conversationId ?? 'chief';
  const key = scope === null ? base : `${base}:scoped`;
  useSyncScopeEffect(() => {
    questionDockState.setScope(key);
  }, [key]);
  return key;
}

export function useQuestionPending(): boolean {
  return useShownQuestions().length > 0;
}

function useShownQuestion(): { shown: OriginChiefQuestion | undefined; scopeKey: string } {
  const pending = useShownQuestions();
  const scopeKey = useQuestionScopeKey(pending);
  const shown = pending[clampQuestionIndex(questionDockState.focus(scopeKey), pending.length)];
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (shown === undefined ? -1 : stepOf(shown)),
    () => -1,
  );
  return { shown, scopeKey };
}

export function useAnswerKey(): string | null {
  const { shown, scopeKey } = useShownQuestion();
  if (shown === undefined) return null;
  if (isApprovalRequest(shown.item.requestId)) return null;
  if (questionDockState.minimized(scopeKey)) return null;
  return answerKeyOf(draftKeyOf(shown), stepOf(shown));
}

export interface MinimizedQuestionState {
  placeholder: string | null;
  restore: () => void;
}

export function useMinimizedQuestion(): MinimizedQuestionState | null {
  const { shown, scopeKey } = useShownQuestion();
  if (shown === undefined || !questionDockState.minimized(scopeKey)) return null;
  const raw = shown.item.questions[stepOf(shown)]?.question ?? '';
  const text = isApprovalRequest(shown.item.requestId) ? '' : plainQuestionLine(raw);
  return {
    placeholder: text === '' ? null : text,
    restore: () => questionDockState.reveal(scopeKey),
  };
}

export function QuestionRestoreButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <IconTooltip
      label={t('展开提问')}
      trigger={
        <Button
          variant="ghost"
          data-testid="chief-question-restore"
          aria-label={t('展开提问')}
          className="size-8 flex-none rounded-full p-0 text-content-tertiary hover:bg-(--menu-hover) hover:text-foreground pointer-coarse:size-11"
          onClick={onClick}
        />
      }
    >
      <ChevronUp className="size-4" />
    </IconTooltip>
  );
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

function pagerOf(pending: OriginChiefQuestion[], at: number, scopeKey: string): DockPager {
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
    questionDockState.setFocus(at + delta, scopeKey);
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
  const scopeKey = useQuestionScopeKey(pending);
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => pending.map(stepOf).join(','),
    () => '',
  );
  const arrived = useArrivals(
    pending.map((request) => request.item.requestId),
    root?.surface.load === 'ready',
  );
  const at = clampQuestionIndex(questionDockState.focus(scopeKey), pending.length);
  const shown = pending[at];
  if (shown === undefined || questionDockState.minimized(scopeKey)) return null;
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
        bound={!isApprovalRequest(shown.item.requestId)}
        enter={arrived.has(shown.item.requestId)}
        pager={pagerOf(pending, at, scopeKey)}
        onMinimize={() => questionDockState.minimize(scopeKey)}
        onAnswer={(input) =>
          root?.surface.onAnswerQuestion?.({ ...input, threadId: shown.conversationId })
        }
        onCancel={(requestId) => root?.surface.onCancelQuestion?.(requestId, shown.conversationId)}
        footer={<QuestionError draftKey={key} />}
      />
    </div>
  );
}
