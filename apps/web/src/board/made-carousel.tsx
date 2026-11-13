import { FileText, GitPullRequest, Globe, Lock, Package, Palette } from 'lucide-react';
import { type FocusEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, ChevronRight } from '../icons/index.js';
import { MADE_GROUP_LABEL, type MadeGroupKey, madeKindOf } from './made-groups.js';

const KIND_ICON: Record<MadeGroupKey, typeof FileText> = {
  document: FileText,
  design: Palette,
  page: Globe,
  code: GitPullRequest,
  other: Package,
};

export function MadeCard({
  todo,
  meta,
  pr,
  onOpen,
}: {
  todo: TodoRecord;
  meta: string;
  pr: { number: number; url: string } | undefined;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const kind = madeKindOf(todo);
  const Icon = KIND_ICON[kind];
  return (
    <li className="flex snap-start">
      <article
        data-testid="made-card"
        data-kind={kind}
        className="relative flex h-36 w-full flex-col overflow-hidden rounded-(--radius-card) bg-background shadow-(--e1-lift) hover:bg-(--menu-hover)"
      >
        <Button
          variant="ghost"
          aria-label={todo.title}
          onClick={onOpen}
          className="absolute inset-0 size-full rounded-(--radius-card) p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset dark:hover:bg-transparent"
        />
        <h4 className="pointer-events-none relative m-0 flex-none px-4 pt-5 text-card-title font-semibold text-foreground">
          <span className="line-clamp-2">{todo.title}</span>
        </h4>
        <div className="pointer-events-none relative mt-1.5 flex h-5 flex-none items-center gap-2 px-4">
          <span className="flex size-5 flex-none items-center justify-center rounded-(--cds-radius-md) bg-secondary text-content-secondary">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <span
            data-testid="made-card-meta"
            className="min-w-0 flex-1 truncate text-meta text-content-tertiary"
          >
            {meta}
          </span>
          {pr !== undefined && (
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="pointer-events-auto flex-none text-meta text-content-secondary hover:text-foreground"
            >
              {`PR #${pr.number}`}
            </a>
          )}
          {todo.visibility === 'private' && (
            <span className="flex flex-none text-content-tertiary">
              <Lock aria-hidden="true" className="size-4" />
              <span className="sr-only">{t('仅自己可见')}</span>
            </span>
          )}
        </div>
        <div
          data-testid="made-card-preview"
          className="pointer-events-none absolute inset-x-3 bottom-0 h-12 overflow-hidden rounded-t-(--radius-tile) border border-b-0 border-border bg-background"
        >
          {todo.previewUrl === undefined ? (
            <div
              data-testid="made-card-placeholder"
              className="flex size-full items-start justify-center bg-secondary pt-5 text-content-dim"
            >
              <Icon aria-hidden="true" className="size-5.5" />
            </div>
          ) : (
            <img
              src={todo.previewUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover object-top"
            />
          )}
        </div>
      </article>
    </li>
  );
}

const PAGER_GUTTER = 16;
const PAGER_ROOM = 32;
const EDGE_ROOM = 6;

export function MadeCarousel({
  groupKey,
  count,
  children,
}: {
  groupKey: MadeGroupKey;
  count: number;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ prev: false, next: false });
  const measure = useCallback(() => {
    const el = ref.current;
    const frame = el?.parentElement;
    if (el == null || frame == null) return;
    const prev = el.scrollLeft > 1;
    const room = frame.clientWidth - (PAGER_GUTTER - EDGE_ROOM) * 2 - (prev ? PAGER_ROOM : 0);
    setEdges({ prev, next: el.scrollLeft + room < el.scrollWidth - 1 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el === null || count === 0) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, count]);
  const pageStep = (el: HTMLUListElement): number | null => {
    const card = el.firstElementChild;
    if (card === null) return null;
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    return 2 * (card.getBoundingClientRect().width + gap);
  };
  const scrollToPage = (el: HTMLUListElement, index: number, step: number) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: Math.max(0, index * step), behavior: reduce ? 'auto' : 'smooth' });
  };
  const page = (direction: 1 | -1) => {
    const el = ref.current;
    const step = el === null ? null : pageStep(el);
    if (el === null || step === null) return;
    scrollToPage(el, Math.round(el.scrollLeft / step) + direction, step);
  };
  const followFocus = (event: FocusEvent<HTMLUListElement>) => {
    const el = event.currentTarget;
    const item = event.target.closest('li');
    const step = pageStep(el);
    if (item === null || step === null) return;
    scrollToPage(el, Math.floor([...el.children].indexOf(item) / 2), step);
  };
  const label = t(MADE_GROUP_LABEL[groupKey]);
  return (
    <div className="@container relative">
      <ul
        ref={ref}
        aria-label={label}
        data-testid="made-carousel"
        data-prev={edges.prev || undefined}
        data-next={edges.next || undefined}
        onScroll={measure}
        onFocus={followFocus}
        className="-mt-px mr-2.5 mb-0 ml-2.5 grid list-none auto-cols-[calc((100cqw-var(--spacing)*19)/2)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-px-1.5 px-1.5 pt-0.5 pb-1 snap-x snap-mandatory data-next:mr-10.5 data-prev:ml-10.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
      {edges.prev && (
        <IconTooltip
          label={t('上一页')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              tabIndex={-1}
              data-testid="made-carousel-prev"
              onClick={() => page(-1)}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 bg-background text-content-secondary hover:text-foreground"
            />
          }
        >
          <ChevronLeft aria-hidden="true" className="size-5.5" />
        </IconTooltip>
      )}
      {edges.next && (
        <IconTooltip
          label={t('下一页')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              tabIndex={-1}
              data-testid="made-carousel-next"
              onClick={() => page(1)}
              className="absolute top-1/2 right-4 -translate-y-1/2 text-content-secondary hover:text-foreground"
            />
          }
        >
          <ChevronRight aria-hidden="true" className="size-5.5" />
        </IconTooltip>
      )}
    </div>
  );
}
