import { cn } from 'cn';
import type { ComponentProps, ComponentType, ReactNode, SVGProps } from 'react';
import { CODE_PILL_CLS } from './code-pill.js';

export type NoticeTone = 'info' | 'waiting' | 'warning' | 'danger';

const TONE_INK: Record<NoticeTone, string> = {
  info: 'text-icon',
  waiting: 'text-content-tertiary',
  warning: 'text-(--card-button)',
  danger: 'text-destructive',
};

export function withCodeSpans(text: string): ReactNode[] {
  return text.split(/`([^`]+)`/).map((part, i) =>
    i % 2 === 1 ? (
      <code key={part} className={CODE_PILL_CLS}>
        {part}
      </code>
    ) : (
      part
    ),
  );
}

export function NoticeBanner({
  tone,
  icon: Icon,
  title,
  body,
  actions,
  className,
  ...rest
}: {
  tone: NoticeTone;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  className?: string;
} & Omit<ComponentProps<'section'>, 'title'>) {
  return (
    <section
      className={cn(
        'board-notify-banner flex items-start gap-3 rounded-(--radius-card) bg-card px-4 py-3 shadow-(--e1)',
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4.5 flex-none', TONE_INK[tone])} />
      <div className="min-w-0 flex-1">
        <div className="text-ui font-semibold text-foreground">{title}</div>
        {body != null && (
          <div className="mt-0.5 text-meta leading-5 text-content-secondary">{body}</div>
        )}
      </div>
      {actions != null && (
        <div className="-my-0.5 flex flex-none items-center gap-1 self-center">{actions}</div>
      )}
    </section>
  );
}
