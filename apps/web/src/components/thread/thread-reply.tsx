import { cn } from 'cn';
import { type KeyboardEvent, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { ArrowUp } from '../../icons/index.js';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '../ui/input-group.js';

export type ThreadReplyDelivery = 'steer' | 'revision' | 'restart';

const THREAD_REPLY_HINT: Record<ThreadReplyDelivery, string> = {
  steer: '直接发给这个任务，插进它这一轮。',
  revision: '作为改计划的意见发给这个任务，不算批准。',
  restart: '这个任务会带着这句话重跑。',
};

export interface ThreadReplyProps {
  delivery: ThreadReplyDelivery;
  onSend: (text: string) => Promise<void>;
  autoFocus?: boolean;
  className?: string;
}

export function ThreadReply({ delivery, onSend, autoFocus, className }: ThreadReplyProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const text = draft.trim();

  const submit = () => {
    if (text === '' || state === 'sending') return;
    setState('sending');
    onSend(text).then(
      () => {
        setDraft('');
        setState('sent');
      },
      () => setState('failed'),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const note =
    state === 'sent'
      ? t('已发出。')
      : state === 'failed'
        ? t('没发出去，再试一次。')
        : t(THREAD_REPLY_HINT[delivery]);

  return (
    <InputGroup
      data-slot="thread-reply"
      className={cn(
        'h-auto has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30',
        className,
      )}
    >
      <InputGroupTextarea
        aria-label={t('回复这个任务')}
        placeholder={t('回复这个任务…')}
        rows={1}
        autoFocus={autoFocus}
        readOnly={state === 'sending' || state === 'sent'}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (state !== 'sending') setState('idle');
        }}
        onKeyDown={onKeyDown}
        className="min-h-0 py-2 text-ui"
      />
      <InputGroupAddon align="block-end" className="justify-between gap-2 pt-0">
        <span
          data-state={state}
          className="min-w-0 truncate text-meta font-normal text-content-tertiary data-[state=failed]:text-destructive"
        >
          {note}
        </span>
        <InputGroupButton
          size="icon-xs"
          variant="default"
          aria-label={t('发送')}
          disabled={text === '' || state === 'sending'}
          onClick={submit}
        >
          <ArrowUp aria-hidden="true" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
