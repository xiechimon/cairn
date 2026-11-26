import { cn } from 'cn';
import type { ComponentProps } from 'react';

export const CHAT_BODY_CLS = 'text-ui leading-5';

export const MESSAGE_COL_MAX_CLS =
  'max-w-[min(85%,42rem)] sm:max-w-[min(85%,42rem,calc(100%-10rem))]';

export type MessageSide = 'owner' | 'coordinator';

export type BubbleRun = 'first' | 'middle' | 'last';

const JOINED_CLS: Record<MessageSide, Record<BubbleRun, string>> = {
  owner: {
    first: 'rounded-br-(--radius-sm)',
    middle: 'rounded-r-(--radius-sm)',
    last: 'rounded-tr-(--radius-sm)',
  },
  coordinator: {
    first: 'rounded-bl-(--radius-sm)',
    middle: 'rounded-l-(--radius-sm)',
    last: 'rounded-tl-(--radius-sm)',
  },
};

const BUBBLE_CLS = `relative w-fit max-w-full min-w-0 rounded-(--radius-bubble) px-3.5 py-2 font-sans ${CHAT_BODY_CLS} text-(--foreground) [overflow-wrap:anywhere]`;

const SIDE_CLS: Record<MessageSide, string> = {
  owner: 'bg-(--bubble-fill) data-reply-highlight:bg-(--bubble-highlight)',
  coordinator: 'bg-(--reply-bubble-fill) data-reply-highlight:bg-(--reply-bubble-highlight)',
};

const TAIL_CLS =
  "after:pointer-events-none after:absolute after:-right-1.5 after:bottom-0 after:h-4.5 after:w-5 after:bg-inherit after:content-[''] after:[clip-path:path('M14_0C14_9_15.5_15_20_18H0Z')]";

export function MessageBubble({
  side,
  className,
  run,
  tail = true,
  ...props
}: ComponentProps<'div'> & { side: MessageSide; run?: BubbleRun | undefined; tail?: boolean }) {
  const tailed = side === 'owner' && tail && run !== 'first' && run !== 'middle';
  return (
    <div
      {...props}
      data-slot="message-bubble"
      data-side={side}
      data-tail={tailed ? '' : undefined}
      data-run={run}
      className={cn(
        BUBBLE_CLS,
        SIDE_CLS[side],
        tailed && TAIL_CLS,
        run !== undefined && JOINED_CLS[side][run],
        className,
      )}
    />
  );
}
