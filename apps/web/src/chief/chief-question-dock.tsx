import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ChiefQuestionCard } from './chief-question-card.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { clampQuestionIndex } from './question-dock-index.js';
import { questionDraftKey, questionDraftStore } from './question-drafts.js';
import type { OriginChiefQuestion } from './question-origin.js';

const DOCK_CLS = 'flex max-h-[min(60dvh,32rem)] flex-none flex-col gap-1.5 overflow-y-auto';

function DockQuestion({ request }: { request: OriginChiefQuestion }) {
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
        numberKeys={false}
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

export function ChiefQuestionDock({ home }: { home: boolean }) {
  const { t } = useI18n();
  const root = useOptionalChiefRoot();
  const pending = root?.pendingQuestions ?? [];
  const [index, setIndex] = useState(0);
  const at = clampQuestionIndex(index, pending.length);
  const shown = pending[at];
  if (shown === undefined) return null;
  return (
    <section
      data-testid="chief-question-dock"
      aria-label={t('待回答的提问')}
      className={`${DOCK_CLS} ${home ? 'mx-auto mt-2 w-[calc(100%-2rem)] max-w-182' : 'mx-4 mt-2'}`}
    >
      {pending.length > 1 && (
        <div className="flex items-center gap-1 text-caption text-content-tertiary">
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="chief-question-prev"
            aria-label={t('上一条提问')}
            disabled={at === 0}
            onClick={() => setIndex(at - 1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <span data-testid="chief-question-position" className="tabular-nums">
            {at + 1}/{pending.length}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="chief-question-next"
            aria-label={t('下一条提问')}
            disabled={at === pending.length - 1}
            onClick={() => setIndex(at + 1)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      )}
      <DockQuestion key={shown.item.requestId} request={shown} />
    </section>
  );
}
