import { cn } from 'cn';
import type { ReactNode } from 'react';

export function Greeting({
  children,
  since,
  as: Tag = 'p',
  wrap = false,
}: {
  children: ReactNode;
  since?: ReactNode;
  as?: 'p' | 'h2';
  wrap?: boolean;
}) {
  return (
    <div data-slot="greeting" className="flex flex-col gap-0.5">
      <Tag
        className={cn(
          'm-0 voice-greeting text-greeting text-foreground',
          wrap ? 'text-balance' : 'whitespace-nowrap',
        )}
      >
        {children}
      </Tag>
      {since != null && <p className="m-0 text-meta text-content-tertiary">{since}</p>}
    </div>
  );
}
