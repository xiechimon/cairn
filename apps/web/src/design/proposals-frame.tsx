import { cn } from 'cn';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import type { StoneTone } from '../components/stone/tone.js';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
import { Button } from '../components/ui/button.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
} from '../components/ui/message-scroller.js';
import { Composer } from '../detail/composer.js';
import { Specimen } from './specimen.js';

export function Option({
  shot,
  title,
  note,
  children,
}: {
  shot: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div data-shot={shot}>
      <Specimen title={title} {...(note != null ? { note } : {})} stage="canvas">
        {children}
      </Specimen>
    </div>
  );
}

export function StateGrid({ children }: { children: ReactNode }) {
  return <div className="grid w-full grid-cols-2 items-start gap-x-4 gap-y-6">{children}</div>;
}

export function State({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', wide && 'col-span-2')}>
      {children}
      <span className="text-caption text-content-tertiary">{label}</span>
    </div>
  );
}

export function FrameTranscript({ children }: { children: ReactNode }) {
  return (
    <MessageScrollerProvider autoScroll={false} defaultScrollPosition="start">
      <MessageScroller className="h-auto min-h-0 flex-1">
        <FadeScrollerViewport className="chat-col pt-4 pr-4 pb-4 pl-5">
          <MessageScrollerContent className="mx-auto block w-full max-w-(--chat-max-w) gap-0">
            {children}
          </MessageScrollerContent>
        </FadeScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export function SideChatFrame({
  seq = 2323,
  title = 'Side chat additions',
  tone = 'working',
  state = 'Working',
  meta = 'omarchy · 3m ago',
  wide = false,
  heightClass = 'h-150',
  titleExtra,
  statusExtra,
  headerActions,
  belowHeader,
  overlay,
  aboveComposer,
  streaming = false,
  composerPlaceholder,
  hideComposer = false,
  children,
}: {
  seq?: number;
  title?: string;
  tone?: StoneTone;
  state?: string;
  meta?: string;
  wide?: boolean;
  heightClass?: string;
  titleExtra?: ReactNode;
  statusExtra?: ReactNode;
  headerActions?: ReactNode;
  belowHeader?: ReactNode;
  overlay?: ReactNode;
  aboveComposer?: ReactNode;
  streaming?: boolean;
  composerPlaceholder?: string;
  hideComposer?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="draft-side-chat"
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) bg-background ring-1 ring-border',
        wide ? 'w-full' : 'w-105',
        heightClass,
      )}
    >
      <header className="flex flex-none flex-col gap-0.5 border-b border-border pt-2.5 pr-2.5 pb-2.5 pl-4">
        <div className="flex min-w-0 items-center gap-1">
          <ToneGlyph tone={tone} still className="size-3.5 flex-none" />
          <h2 className="m-0 ml-0.5 min-w-0 truncate text-ui font-semibold text-foreground">
            <span className="font-normal text-content-tertiary tabular-nums">#{seq}</span> {title}
          </h2>
          {titleExtra}
          <span className="flex-1" />
          {headerActions}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            className="text-content-tertiary hover:text-foreground"
          >
            <X aria-hidden="true" strokeWidth={1.75} className="size-4" />
          </Button>
        </div>
        <p className="m-0 flex min-w-0 items-center gap-1.5 pl-5 text-meta text-content-tertiary">
          <span className="flex-none font-medium text-content-secondary">{state}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{meta}</span>
          {statusExtra}
        </p>
      </header>
      {belowHeader}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {aboveComposer}
      {!hideComposer && (
        <Composer
          placeholder={composerPlaceholder ?? `Reply to #${seq}…`}
          aiReview={false}
          streaming={streaming}
          editable
        />
      )}
      {overlay}
    </div>
  );
}
