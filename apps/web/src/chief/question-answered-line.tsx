import { cn } from 'cn';
import { Ban, CircleCheck } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { REPLY_BLOCK_CLS, REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { MessageToolbar } from './message-toolbar.js';
import type { ChiefQuestionItem } from './question-chips.js';

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

export function QuestionAsked({
  item,
  onCopy,
}: {
  item: ChiefQuestionItem;
  onCopy?: ((text: string) => void) | undefined;
}) {
  return (
    <div
      data-testid="chief-question-asked"
      data-request-id={item.requestId}
      data-slot="reply-blocks"
      className="flex w-full max-w-full min-w-0 flex-col items-start gap-1"
    >
      {item.questions.map((question, n) => {
        const bubble = (
          <div
            data-slot="reply-bubble"
            data-testid="chief-reply-bubble"
            className={cn(REPLY_BUBBLE_CLS, 'text-ui leading-5 break-words')}
          >
            {question.question}
          </div>
        );
        return (
          <div key={n} className={REPLY_BLOCK_CLS} data-slot="reply-block">
            {question.header === '' ? (
              bubble
            ) : (
              <Tooltip>
                <TooltipTrigger render={bubble} />
                <TooltipContent side="top" sideOffset={6} className="max-w-72">
                  {question.header}
                </TooltipContent>
              </Tooltip>
            )}
            {onCopy !== undefined && (
              <MessageToolbar
                placement="right"
                testId={n === 0 ? 'chief-msg-foot' : 'chief-msg-block-tools'}
                stamp={null}
                onCopy={() => onCopy(question.question)}
              />
            )}
          </div>
        );
      })}
      {onCopy !== undefined && (
        <MessageToolbar
          placement="below-start"
          testId="chief-msg-tools-touch"
          stamp={null}
          onCopy={() => onCopy(item.questions.map((question) => question.question).join('\n'))}
        />
      )}
    </div>
  );
}
