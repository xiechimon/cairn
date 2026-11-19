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

const BANNER_CLS = 'board-notify-banner rounded-(--radius-card) bg-card px-4 py-3 shadow-(--e1)';

export function NoticeBanner({
  tone,
  icon: Icon,
  title,
  body,
  actions,
  footer,
  children,
  className,
  ...rest
}: {
  tone: NoticeTone;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentProps<'section'>, 'title' | 'children'>) {
  const icon = (
    <Icon aria-hidden="true" className={cn('mt-0.5 size-5.5 flex-none', TONE_INK[tone])} />
  );
  const text = (
    <div className="min-w-0 flex-1">
      <div className="text-ui font-semibold text-foreground">{title}</div>
      {body != null && (
        <div className="mt-0.5 text-meta leading-5 text-content-secondary">{body}</div>
      )}
      {children}
    </div>
  );
  if (footer != null)
    return (
      <section className={cn(BANNER_CLS, 'flex flex-col gap-3', className)} {...rest}>
        <div className="flex min-w-0 items-start gap-3">
          {icon}
          {text}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
          <div className="min-w-0 flex-1 basis-48 text-meta leading-5 text-content-secondary">
            {footer}
          </div>
          {actions != null && (
            <div className="-my-0.5 ms-auto flex flex-none items-center gap-2">{actions}</div>
          )}
        </div>
      </section>
    );
  return (
    <section
      className={cn(BANNER_CLS, 'flex flex-wrap items-start gap-3 sm:flex-nowrap', className)}
      {...rest}
    >
      {icon}
      {text}
      {actions != null && (
        <div className="-my-0.5 flex flex-none items-center gap-1 self-center max-sm:basis-full max-sm:justify-end">
          {actions}
        </div>
      )}
    </section>
  );
}
