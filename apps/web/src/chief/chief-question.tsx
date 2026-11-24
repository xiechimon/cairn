import type { AskUserAnswer } from '@cairn/shared';
import { cn } from 'cn';
import { ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { isDockedQuestion } from '../board/needs-you.js';
import { useArrivals } from '../components/growth.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { useI18n } from '../i18n/provider.js';
import { isApprovalRequest } from './approval-card-model.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { QUESTION_TOOL_CLS, QuestionCard } from './question-card.js';
import { clampQuestionIndex } from './question-dock-index.js';
import { answerKeyOf, questionDockState } from './question-dock-state.js';
import { questionDraftKey, questionDraftStore } from './question-drafts.js';
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

function useShownRequests() {
  const root = useOptionalChiefRoot();
  const scope = useContext(QuestionScopeContext);
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (root?.pendingQuestions ?? []).map(stepOf).join(','),
    () => '',
  );
  const asks: OriginChiefQuestion[] = [];
  const approvals: OriginChiefQuestion[] = [];
  for (const request of root?.pendingQuestions ?? []) {
    const { requestId } = request.item;
    if ((scope !== null && !scope.has(requestId)) || questionDockState.isDismissing(requestId))
      continue;
    if (isApprovalRequest(requestId)) approvals.push(request);
    else if (isDockedQuestion(request.item)) asks.push(request);
  }
  return { asks, approvals };
}

function focusedOf(asks: OriginChiefQuestion[]): OriginChiefQuestion | undefined {
  return asks[clampQuestionIndex(questionDockState.focus(), asks.length)];
}

export function useQuestionPending(): boolean {
  const { asks, approvals } = useShownRequests();
  return asks.length > 0 || approvals.length > 0;
}

export function useAnswerKey(): string | null {
  const shown = focusedOf(useShownRequests().asks);
  if (shown === undefined) return null;
  return answerKeyOf(draftKeyOf(shown), stepOf(shown));
}

export interface DockedQuestion {
  requestId: string;
  question: string;
  collapsed: boolean;
}

export function useDockedQuestion(): DockedQuestion | null {
  const shown = focusedOf(useShownRequests().asks);
  if (shown === undefined) return null;
  return {
    requestId: shown.item.requestId,
    question: shown.item.questions[stepOf(shown)]?.question ?? '',
    collapsed: questionDockState.isCollapsed(shown.item.requestId),
  };
}

export function QuestionRestoreButton() {
  const { t } = useI18n();
  const shown = focusedOf(useShownRequests().asks);
  if (shown === undefined) return null;
  return (
    <IconTooltip
      label={t('展开提问')}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          data-testid="chief-question-restore"
          className={cn(QUESTION_TOOL_CLS, 'mb-0.5 size-7 self-end text-(--waiting-ink)')}
          onClick={() => questionDockState.expand(shown.item.requestId, { focusRow: true })}
        />
      }
    >
      <ArrowUp width={16} height={16} strokeWidth={1.75} />
    </IconTooltip>
  );
}

function useCardProps(shown: OriginChiefQuestion) {
  const root = useOptionalChiefRoot();
  return {
    item: shown.item,
    draftKey: draftKeyOf(shown),
    onAnswer: (input: { requestId: string; answers: AskUserAnswer[] }) =>
      root?.surface.onAnswerQuestion?.({ ...input, threadId: shown.conversationId }),
    onCancel: (requestId: string) =>
      root?.surface.onCancelQuestion?.(requestId, shown.conversationId),
  };
}

function useArrived(pending: OriginChiefQuestion[]) {
  const root = useOptionalChiefRoot();
  return useArrivals(
    pending.map((request) => request.item.requestId),
    root?.surface.load === 'ready',
  );
}

export function ChiefQuestion() {
  const { t } = useI18n();
  const { approvals } = useShownRequests();
  const arrived = useArrived(approvals);
  const reveal = questionDockState.approvalReveal();
  const shown =
    approvals.find((request) => request.item.requestId === reveal?.requestId) ?? approvals[0];
  const shownId = shown?.item.requestId;
  const itemRef = useRef<HTMLDivElement | null>(null);
  const headerId = useId();
  const revealedRef = useRef(reveal);
  useEffect(() => {
    if (revealedRef.current === reveal) return;
    revealedRef.current = reveal;
    if (reveal?.requestId === shownId) itemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [reveal, shownId]);
  const props = useCardProps(shown ?? PLACEHOLDER);
  if (shown === undefined) return null;
  const header = shown.item.questions[stepOf(shown)]?.header ?? '';
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
        <QuestionCard
          key={shown.item.requestId}
          {...props}
          grow={arrived.has(shown.item.requestId)}
        />
      </section>
    </MessageScrollerItem>
  );
}

const PLACEHOLDER: OriginChiefQuestion = {
  teamId: '',
  conversationId: '',
  origin: '',
  item: {
    kind: 'question',
    id: '',
    requestId: '',
    status: 'pending',
    questions: [],
    answers: null,
  },
};

function QuestionPager({ at, total }: { at: number; total: number }) {
  const { t } = useI18n();
  if (total < 2) return null;
  return (
    <span className="flex items-center">
      <IconTooltip
        label={t('上一个问题')}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            data-testid="chief-question-prev"
            disabled={at === 0}
            className={QUESTION_TOOL_CLS}
            onClick={() => questionDockState.setFocus(at - 1)}
          />
        }
      >
        <ChevronLeft width={16} height={16} strokeWidth={1.75} />
      </IconTooltip>
      <span
        data-testid="chief-question-position"
        className="min-w-7 text-center text-meta tabular-nums text-(--text-tertiary)"
      >
        {`${at + 1}/${total}`}
      </span>
      <IconTooltip
        label={t('下一个问题')}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            data-testid="chief-question-next"
            disabled={at === total - 1}
            className={QUESTION_TOOL_CLS}
            onClick={() => questionDockState.setFocus(at + 1)}
          />
        }
      >
        <ChevronRight width={16} height={16} strokeWidth={1.75} />
      </IconTooltip>
    </span>
  );
}

export function ChiefQuestionDock({ onCollapsed }: { onCollapsed: () => void }) {
  const { t } = useI18n();
  const { asks } = useShownRequests();
  const arrived = useArrived(asks);
  const headerId = useId();
  const shown = focusedOf(asks);
  const props = useCardProps(shown ?? PLACEHOLDER);
  if (shown === undefined) return null;
  const collapsed = questionDockState.isCollapsed(shown.item.requestId);
  const header = shown.item.questions[stepOf(shown)]?.header ?? '';
  const collapse = () => {
    questionDockState.collapse(shown.item.requestId);
    onCollapsed();
  };
  return (
    <section
      data-testid={collapsed ? undefined : 'chief-question'}
      hidden={collapsed}
      aria-label={t('待回答的提问')}
      aria-describedby={header === '' ? undefined : headerId}
      className="mx-auto mb-2 flex max-h-[min(60dvh,560px)] min-h-0 w-[calc(100%-2rem)] max-w-chat shrink flex-col overflow-hidden rounded-(--radius-composer) bg-(--composer-fill) shadow-(--shadow-composer)"
    >
      {header !== '' && (
        <span id={headerId} hidden>
          {header}
        </span>
      )}
      <QuestionCard
        key={shown.item.requestId}
        {...props}
        bound
        grow={arrived.has(shown.item.requestId)}
        pager={<QuestionPager at={asks.indexOf(shown)} total={asks.length} />}
        onCollapse={collapse}
      />
    </section>
  );
}
