import { cn } from 'cn';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight } from '../icons/index.js';

export const DISPLAY_STYLE: CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: 44,
  lineHeight: 1.05,
  letterSpacing: '-0.02em',
};

export function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <section id={id} data-gallery-section="" className="scroll-mt-4 pt-16">
      <h2 className="m-0 text-page font-medium text-foreground">{title}</h2>
      <p className="mt-1.5 mb-6 max-w-160 text-ui text-content-secondary">{lede}</p>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function GroupTitle({ id, title, lede }: { id: string; title: string; lede: string }) {
  return (
    <header id={id} className="scroll-mt-4 border-b border-border pt-24 pb-5">
      <h1 className="m-0 font-semibold text-foreground" style={DISPLAY_STYLE}>
        {title}
      </h1>
      <p className="mt-2 mb-0 max-w-140 text-card-title text-content-secondary">{lede}</p>
    </header>
  );
}

export function Specimen({
  title,
  note,
  code,
  stage = 'card',
  className,
  children,
}: {
  title: string;
  note?: string;
  code?: string;
  stage?: 'card' | 'canvas';
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 overflow-hidden rounded-(--radius-card) bg-card shadow-(--e1)">
      <figcaption className="flex items-baseline gap-3 border-b border-border px-5 py-3">
        <span className="text-ui font-medium text-foreground">{title}</span>
        {note != null && <span className="text-meta text-content-tertiary">{note}</span>}
      </figcaption>
      <div
        className={cn(
          'flex flex-wrap items-start gap-x-8 gap-y-6 px-6 py-7',
          stage === 'canvas' && 'bg-canvas',
          className,
        )}
      >
        {children}
      </div>
      {code != null && (
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-2.5 text-meta text-content-tertiary select-none hover:text-content-secondary">
            <ChevronRight
              width={12}
              height={12}
              className="transition-transform duration-(--dur-fast) group-open:rotate-90"
            />
            Code
          </summary>
          <pre className="m-0 overflow-x-auto bg-canvas px-5 py-4 font-mono text-caption leading-5 text-content-secondary">
            <code>{code.trim()}</code>
          </pre>
        </details>
      )}
    </figure>
  );
}

export function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2.5">
      <div className="flex min-h-8 flex-wrap items-center gap-2">{children}</div>
      <span className="text-caption text-content-tertiary">{label}</span>
    </div>
  );
}
