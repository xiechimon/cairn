import { cn } from 'cn';
import { Ban, CircleCheck } from 'lucide-react';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { ApprovalHistoryLine } from './approval-card.js';
import { approvalCardOf, approvalChoiceLabel } from './approval-card-model.js';
import type { ChiefQuestionItem } from './question-item.js';
import { answerLineOf } from './question-lifecycle.js';

export function QuestionReceipt({ item }: { item: ChiefQuestionItem }) {
  const { t } = useI18n();
  const skipped = item.status === 'cancelled';
  return (
    <div
      data-testid="chief-question-receipt"
      data-request-id={item.requestId}
      data-status={item.status}
      className="flex w-fit max-w-[min(var(--container-reply),100%)] flex-col gap-2 rounded-xl px-3 py-2 font-sans shadow-[0_0_0_1px_var(--border)] wrap-anywhere dark:bg-card"
    >
      {item.questions.map((question, n) => {
        const answer = skipped ? '' : answerLineOf(item.answers?.[n]);
        return (
          <div key={n} className="flex min-w-0 flex-col">
            <div
              data-testid="chief-question-receipt-question"
              className="line-clamp-2 text-meta text-content-tertiary [&_p]:m-0 [&_p]:inline"
            >
              <ChatMarkdown text={question.question} />
            </div>
            <p
              data-testid="chief-question-receipt-answer"
              className={cn(
                'm-0 text-ui',
                answer === '' ? 'text-content-tertiary' : 'text-foreground',
              )}
            >
              {answer === '' ? t('已跳过') : answer}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function ApprovalAnswered({ item }: { item: ChiefQuestionItem }) {
  const { t } = useI18n();
  const question = item.questions[0];
  if (question === undefined) return null;
  if (item.status === 'cancelled') {
    const expired = item.cancelReason?.includes('已过期') === true;
    return (
      <ApprovalHistoryLine
        card={approvalCardOf(question, t)}
        status={expired ? t('已过期') : t('已取消')}
        outcome={expired ? 'expired' : 'cancelled'}
        icon={<Ban strokeWidth={1.75} className="size-4 text-content-tertiary" />}
      />
    );
  }
  const choice = item.answers?.[0]?.choices?.[0] ?? null;
  const index = choice === null ? -1 : question.options.findIndex((o) => o.label === choice);
  const declined = index > 0 && index === question.options.length - 1;
  const status =
    index === 0
      ? t('已批准')
      : declined
        ? t('已拒绝')
        : choice !== null && index > 0
          ? approvalChoiceLabel(choice, t)
          : t('已回答');
  const Icon = declined ? Ban : CircleCheck;
  return (
    <ApprovalHistoryLine
      card={approvalCardOf(question, t)}
      status={status}
      outcome={index === 0 ? 'approved' : declined ? 'declined' : 'answered'}
      icon={<Icon strokeWidth={1.75} className="size-4 text-content-tertiary" />}
    />
  );
}
