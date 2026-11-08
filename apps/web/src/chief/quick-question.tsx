import type { AskUserAnswer } from '@cairn/shared';
import { useSyncExternalStore } from 'react';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ChiefQuestionCard, recommendedFirst } from './chief-question-card.js';
import { useOptionalChiefRoot } from './chief-root.js';
import { questionDraftKey, questionDraftStore, questionSubmitStore } from './question-drafts.js';
import type { OriginChiefQuestion } from './question-origin.js';

function draftKeyOf(request: OriginChiefQuestion): string {
  return questionDraftKey({
    teamId: request.teamId,
    conversationId: request.conversationId,
    requestId: request.item.requestId,
  });
}

export function useAnswerCoordinator(request: OriginChiefQuestion) {
  const root = useOptionalChiefRoot();
  const key = draftKeyOf(request);
  const submitting = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => questionSubmitStore.get(key).submitting,
    () => false,
  );
  const error = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => questionSubmitStore.get(key).error,
    () => null,
  );
  const answer = (answers: AskUserAnswer[]) =>
    root?.surface.onAnswerQuestion?.({
      requestId: request.item.requestId,
      answers,
      threadId: request.conversationId,
    });
  return { key, submitting, error, answer };
}

export function QuickQuestion({
  request,
  hideText = false,
}: {
  request: OriginChiefQuestion;
  hideText?: boolean;
}) {
  const { key, submitting, error, answer } = useAnswerCoordinator(request);
  const [first] = request.item.questions;
  if (
    request.item.questions.length !== 1 ||
    first === undefined ||
    first.multiSelect === true ||
    first.options.length === 0
  ) {
    return (
      <>
        <ChiefQuestionCard
          item={request.item}
          draftKey={key}
          onAnswer={(input) => answer(input.answers)}
        />
        {error !== null && (
          <p
            role="status"
            data-testid="quick-question-error"
            className="m-0 text-meta text-destructive"
          >
            {error}
          </p>
        )}
      </>
    );
  }
  const question = recommendedFirst(first);
  const described = question.options.some(
    (option) => option.description !== undefined && option.description !== '',
  );
  return (
    <div data-testid="quick-question" className="flex min-w-0 flex-col gap-2">
      {!hideText && (
        <p data-testid="quick-question-text" className="m-0 text-ui text-foreground">
          {question.question}
        </p>
      )}
      <div className={described ? 'flex flex-col items-start gap-1.5' : 'flex flex-wrap gap-1.5'}>
        {question.options.map((option, index) => (
          <Button
            key={option.label}
            size="sm"
            data-testid={`quick-question-option-${index}`}
            variant={option.recommended === true ? 'default' : 'outline'}
            disabled={submitting}
            onClick={() => answer([{ header: question.header, choices: [option.label] }])}
            className={
              described
                ? 'h-auto max-w-full flex-col items-start gap-0 py-1.5 text-left whitespace-normal'
                : undefined
            }
          >
            {option.label}
            {described && option.description !== undefined && option.description !== '' && (
              <span className="text-caption font-normal opacity-70">{option.description}</span>
            )}
          </Button>
        ))}
      </div>
      {error !== null && (
        <p
          role="status"
          data-testid="quick-question-error"
          className="m-0 text-meta text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function InlineCoordinatorQuestion({ request }: { request: OriginChiefQuestion }) {
  const { t } = useI18n();
  return (
    <section
      data-testid="inline-question"
      data-request-id={request.item.requestId}
      aria-label={t('待回答的提问')}
      className="flex flex-col gap-1.5 rounded-(--radius-card) bg-(--card) px-3.5 py-3 ring-1 ring-(--border)"
    >
      <p className="m-0 flex items-center gap-1.5 text-meta text-content-tertiary">
        <ToneGlyph tone="waiting" className="size-3.5" />
        {t('在问你')} · {request.item.questions[0]?.header}
      </p>
      <QuickQuestion request={request} />
    </section>
  );
}
