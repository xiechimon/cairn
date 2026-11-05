import { CircleHelp } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { THREAD_PARAM } from '../board/thread-copy.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ChiefQuestionCard } from './chief-question-card.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { questionDraftKey, questionDraftStore } from './question-drafts.js';
import type { OriginChiefQuestion } from './question-origin.js';

export function BoardQuestionBar() {
  return (
    <div
      data-testid="board-question-bar"
      className="flex h-12 flex-none items-center justify-end pr-3 pl-5 max-[640px]:pl-14"
    >
      <ChiefQuestionEntry />
    </div>
  );
}

export function ChiefQuestionEntry() {
  const { t } = useI18n();
  const root = useOptionalChiefRoot();
  const count = root?.pendingQuestions.length ?? 0;
  if (root === null || count === 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="chief-question-entry"
      className="gap-1.5 text-content-secondary"
      aria-label={t('{n} 个待回答提问', { n: count })}
      aria-expanded={root.questionsOpen}
      onClick={() => root.setQuestionsOpen(true)}
    >
      <CircleHelp aria-hidden className="size-4" />
      {t('提问')}
      <span
        data-testid="chief-question-count"
        className="text-caption tabular-nums text-content-tertiary"
      >
        {count}
      </span>
    </Button>
  );
}

function OriginList({
  pending,
  selectedId,
  onSelect,
}: {
  pending: readonly OriginChiefQuestion[];
  selectedId: string | undefined;
  onSelect: (requestId: string) => void;
}) {
  if (pending.length < 2) return null;
  return (
    <div className="mb-3 flex flex-col gap-1">
      {pending.map((request) => (
        <Button
          key={request.item.requestId}
          variant="ghost"
          size="sm"
          data-testid="chief-question-pick"
          className="h-auto justify-start whitespace-normal py-2 text-left font-normal"
          aria-pressed={selectedId === request.item.requestId}
          onClick={() => onSelect(request.item.requestId)}
        >
          <CircleHelp aria-hidden className="size-3.5 flex-none text-content-tertiary" />
          {request.item.questions[0]?.header ?? request.origin}
        </Button>
      ))}
    </div>
  );
}

function QuestionBody({
  request,
  numberKeys,
}: {
  request: OriginChiefQuestion;
  numberKeys: boolean;
}) {
  const { t } = useI18n();
  const root = useOptionalChiefRoot();
  const key = questionDraftKey({
    teamId: request.teamId,
    conversationId: request.conversationId,
    requestId: request.item.requestId,
  });
  const error = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => questionDraftStore.get(key)?.error ?? null,
    () => null,
  );
  return (
    <div>
      <Button
        variant="link"
        size="sm"
        data-testid="chief-question-origin"
        className="mb-2 h-auto whitespace-normal p-0 text-left text-caption"
        onClick={() => root?.openQuestionOrigin(request.conversationId)}
      >
        {t('打开提问来源：{origin}', { origin: request.origin })}
      </Button>
      {error !== null && (
        <p
          role="status"
          data-testid="chief-question-error"
          className="mb-3 text-ui text-destructive"
        >
          {error}
        </p>
      )}
      <ChiefQuestionCard
        item={request.item}
        draftKey={key}
        numberKeys={numberKeys}
        onAnswer={(input) =>
          root?.surface.onAnswerQuestion?.({
            ...input,
            threadId: request.conversationId,
          })
        }
        onCancel={(requestId) =>
          root?.surface.onCancelQuestion?.(requestId, request.conversationId)
        }
      />
    </div>
  );
}

export function ChiefQuestionPanel() {
  const { t } = useI18n();
  const root = useOptionalChiefRoot();
  const [searchParams] = useSearchParams();
  const pending = root?.pendingQuestions ?? [];
  const [selectedId, setSelectedId] = useState(pending[0]?.item.requestId);
  const selected = pending.find((request) => request.item.requestId === selectedId) ?? pending[0];
  useEffect(() => {
    if (
      selectedId !== undefined &&
      pending.some((request) => request.item.requestId === selectedId)
    )
      return;
    setSelectedId(pending[0]?.item.requestId);
  }, [pending, selectedId]);
  if (root === null || !root.questionsOpen || pending.length === 0 || selected === undefined)
    return null;
  const threadOpen = searchParams.get(THREAD_PARAM) !== null;
  return (
    <SidePanel
      label={t('待回答的提问')}
      onDismiss={() => root.setQuestionsOpen(false)}
      scrimTestId="chief-question-scrim"
    >
      <div data-testid="chief-question-panel" className="flex min-h-0 flex-1 flex-col">
        <SidePanelHead closeLabel={t('收起提问')} onClose={() => root.setQuestionsOpen(false)}>
          <SidePanelTitle>
            {t('提问')} · {pending.length}
          </SidePanelTitle>
          <Button
            variant="ghost"
            size="sm"
            data-testid="chief-question-later"
            onClick={() => root.setQuestionsOpen(false)}
          >
            {t('稍后')}
          </Button>
        </SidePanelHead>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <OriginList
            pending={pending}
            selectedId={selected.item.requestId}
            onSelect={setSelectedId}
          />
          <QuestionBody key={selected.item.requestId} request={selected} numberKeys={!threadOpen} />
        </div>
      </div>
    </SidePanel>
  );
}
