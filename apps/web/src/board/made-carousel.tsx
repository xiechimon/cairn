import { Lock } from 'lucide-react';
import {
  type FocusEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { reportSummaryOf, useBuildReport } from '../chief/research-report.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, ChevronRight } from '../icons/index.js';
import { MADE_GROUP_LABEL, type MadeGroupKey } from './made-groups.js';

const CARD_CLS =
  'relative flex h-38 w-full flex-col overflow-hidden rounded-(--radius-card) bg-background px-4 pt-3.5 pb-3 shadow-(--e1-lift)';

const CAROUSEL_CLS =
  '-mt-px mr-2.5 mb-0 ml-2.5 grid list-none auto-cols-[calc((100cqw-var(--spacing)*19)/2)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-px-1.5 px-1.5 pt-0.5 pb-1 snap-x snap-mandatory data-next:mr-10.5 data-prev:ml-10.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

const SKELETON_DELAY_MS = 200;

const BAR = 'rounded-sm bg-border';

function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}

function useCardExcerpt(todo: TodoRecord, seen: boolean): { excerpt: string; loading: boolean } {
  const thread = useMemo(
    () =>
      seen && todo.output === 'info' && todo.latestBuildId !== null
        ? { buildId: todo.latestBuildId, title: todo.title, phase: todo.phase }
        : null,
    [seen, todo.output, todo.latestBuildId, todo.title, todo.phase],
  );
  const { report, settled } = useBuildReport(thread);
  return {
    excerpt: report === null ? '' : reportSummaryOf(report.content),
    loading: thread !== null && !settled,
  };
}

export function MadeCard({
  todo,
  meta,
  onOpen,
}: {
  todo: TodoRecord;
  meta: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLLIElement | null>(null);
  const { excerpt, loading } = useCardExcerpt(todo, useSeen(ref));
  return (
    <li ref={ref} className="flex snap-start">
      <article data-testid="made-card" className={`${CARD_CLS} hover:bg-(--menu-hover)`}>
        <Button
          variant="ghost"
          aria-label={todo.title}
          onClick={onOpen}
          className="absolute inset-0 size-full rounded-(--radius-card) p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-inset dark:hover:bg-transparent"
        />
        <h4 className="pointer-events-none relative m-0 flex-none text-ui font-medium text-foreground">
          <span className="line-clamp-2">{todo.title}</span>
        </h4>
        <div
          data-testid="made-card-preview"
          className="pointer-events-none relative mt-1.5 min-h-0 flex-1 overflow-hidden"
        >
          {todo.previewUrl !== undefined ? (
            <img
              src={todo.previewUrl}
              alt=""
              loading="lazy"
              className="size-full rounded-(--radius-tile) border border-border object-cover object-top"
            />
          ) : excerpt !== '' ? (
            <p
              data-testid="made-card-excerpt"
              className="m-0 line-clamp-3 text-meta text-content-secondary"
            >
              {excerpt}
            </p>
          ) : (
            loading && (
              <div data-testid="made-card-excerpt-loading" className="flex flex-col gap-2 pt-1">
                <Skeleton className={`h-2.5 w-full ${BAR}`} />
                <Skeleton className={`h-2.5 w-3/4 ${BAR}`} />
              </div>
            )
          )}
        </div>
        <div className="pointer-events-none relative mt-2 flex h-5 flex-none items-center gap-2">
          <span
            data-testid="made-card-meta"
            className="min-w-0 flex-1 truncate text-meta text-content-tertiary"
          >
            {meta}
          </span>
          {todo.visibility === 'private' && (
            <span className="flex flex-none text-content-tertiary">
              <Lock aria-hidden="true" className="size-4" />
              <span className="sr-only">{t('仅自己可见')}</span>
            </span>
          )}
        </div>
      </article>
    </li>
  );
}

export function MadeSkeleton() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), SKELETON_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <div data-testid="made-skeleton" aria-hidden="true" className="pt-5">
      <Skeleton className={`mx-4 mb-2.5 h-3.5 w-14 ${BAR}`} />
      <div className="@container">
        <div className={CAROUSEL_CLS}>
          {[0, 1].map((key) => (
            <div key={key} className={CARD_CLS}>
              <Skeleton className={`h-3.5 w-4/5 ${BAR}`} />
              <Skeleton className={`mt-3 h-2.5 w-full ${BAR}`} />
              <Skeleton className={`mt-2 h-2.5 w-2/3 ${BAR}`} />
              <Skeleton className={`mt-auto h-2.5 w-2/5 ${BAR}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
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
        className={CAROUSEL_CLS}
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
