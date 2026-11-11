import { cn } from 'cn';
import type { ComponentProps } from 'react';

export const CHAT_BODY_CLS = 'text-ui leading-5';

const TAIL_CLS =
  "after:pointer-events-none after:absolute after:-right-1.5 after:bottom-0 after:h-4.5 after:w-5 after:bg-inherit after:content-[''] after:[clip-path:path('M14_0C14_9_15.5_15_20_18H0Z')]";

export function UserMessageBubble({
  className,
  tail = true,
  ...props
}: ComponentProps<'div'> & { tail?: boolean }) {
  return (
    <div
      data-slot="user-bubble"
      data-tail={tail ? '' : undefined}
      className={cn(
        `relative min-w-0 rounded-(--radius-bubble) bg-(--bubble-fill) px-3.5 py-2 ${CHAT_BODY_CLS} text-(--foreground)`,
        tail && TAIL_CLS,
        className,
      )}
      {...props}
    />
  );
}
