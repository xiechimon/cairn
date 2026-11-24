import { cn } from 'cn';
import { Ban, CircleCheck } from 'lucide-react';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { ApprovalHistoryLine } from './approval-card.js';
import { approvalCardOf } from './approval-card-model.js';
import type { ChiefQuestionItem } from './question-card.js';
import { answerOf } from './question-lifecycle.js';

export function QuestionAnsweredLine({ item }: { item: ChiefQuestionItem }) {
  const { t } = useI18n();
  const cancelled = item.status === 'cancelled';
  const Icon = cancelled ? Ban : CircleCheck;
  const text = cancelled ? t('已取消提问') : t('已回答');
  return (
    <p
      data-testid="chief-question-line"
      data-status={item.status}
      title={text}
      className="m-0 flex min-w-0 items-center gap-1.5 text-meta text-content-tertiary"
    >
      <Icon aria-hidden strokeWidth={1.75} className="size-4 flex-none" />
      <span className="min-w-0 truncate">{text}</span>
    </p>
  );
}

function ReceiptQuestionText({ text }: { text: string }) {
  return (
    <div
      data-testid="chief-question-receipt-question"
      className="line-clamp-2 text-meta leading-[18px] text-pretty text-(--text-tertiary) [overflow-wrap:anywhere] [&_p]:m-0 [&_p]:inline"
    >
      <ChatMarkdown text={text} />
    </div>
  );
}

export function QuestionReceipt({ item }: { item: ChiefQuestionItem }) {
  const { t } = useI18n();
  const cancelled = item.status === 'cancelled';
  if (cancelled && item.cancelledBy === 'coordinator') {
    return (
      <div
        data-testid="chief-question-receipt"
        data-request-id={item.requestId}
        data-status={item.status}
        data-withdrawn=""
        className="flex w-full max-w-full min-w-0 flex-col gap-1.5"
      >
        {item.questions.map((question, n) => (
          <ReceiptQuestionText key={n} text={question.question} />
        ))}
        <p
          data-testid="chief-question-receipt-answer"
          className="m-0 text-ui leading-5 [overflow-wrap:anywhere] whitespace-pre-line text-(--text-tertiary)"
        >
          {t('不再需要回答')}
          {item.cancelReason !== undefined && item.cancelReason !== ''
            ? `：${item.cancelReason}`
            : ''}
        </p>
      </div>
    );
  }
  const status = !cancelled
    ? t('已回答')
    : item.cancelledBy === 'person'
      ? t('已跳过')
      : t('已取消提问');
  return (
    <div
      data-testid="chief-question-receipt"
      data-request-id={item.requestId}
      data-status={item.status}
      className="flex w-full max-w-full min-w-0 flex-col gap-3"
    >
      {item.questions.map((question, n) => {
        const answer = answerOf(item, n);
        return (
          <div key={n} className="flex min-w-0 flex-col gap-0.5">
            <ReceiptQuestionText text={question.question} />
            <p
              data-testid="chief-question-receipt-answer"
              className={cn(
                'm-0 text-ui leading-5 [overflow-wrap:anywhere] whitespace-pre-line',
                answer === null ? 'text-(--text-tertiary)' : 'text-foreground',
              )}
            >
              {answer ?? status}
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
  const choice = item.answers?.[0]?.choices?.[0] ?? null;
  const index = choice === null ? -1 : question.options.findIndex((o) => o.label === choice);
  const declined = index > 0 && index === question.options.length - 1;
  const status =
    index === 0
      ? t('已批准')
      : declined
        ? t('已拒绝')
        : choice !== null && index > 0
          ? choice
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
