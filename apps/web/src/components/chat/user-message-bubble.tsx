import { cn } from 'cn';
import type { ComponentProps } from 'react';

export const CHAT_BODY_CLS = 'text-ui leading-5.5';

export function UserMessageBubble({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="user-bubble"
      className={cn(
        `min-w-0 rounded-(--radius-bubble) rounded-br-(--cds-radius-sm) bg-(--bubble-fill) px-3.5 py-2 ${CHAT_BODY_CLS} text-(--foreground)`,
        className,
      )}
      {...props}
    />
  );
}
