import type { PrPanelRow } from '@cairn/shared';
import { cn } from 'cn';
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { pillOf } from './pr-card.js';
import type { PrCardState } from './pr-card-model.js';
import { prCardModelOfRow, prChecksText } from './pr-panel-model.js';

const COLD_DELAY = 350;
const WARM_WINDOW = 600;

const hoverCards = { open: 0, lastClosedAt: 0 };

export function useWarmHoverCard() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shown = useRef(false);
  const show = () => {
    shown.current = true;
    hoverCards.open += 1;
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (!shown.current) return;
    shown.current = false;
    hoverCards.open -= 1;
    hoverCards.lastClosedAt = Date.now();
    setOpen(false);
  };
  useEffect(() => hide, []);
  const onOpenChange = (next: boolean) => {
    if (!next) return hide();
    if (shown.current) return;
    const warm = hoverCards.open > 0 || Date.now() - hoverCards.lastClosedAt < WARM_WINDOW;
    clearTimeout(timer.current);
    if (warm) show();
    else timer.current = setTimeout(show, COLD_DELAY);
  };
  return { root: { open, onOpenChange }, onPointerLeave: () => clearTimeout(timer.current) };
}

type Tone = 'open' | 'pending' | 'failed' | 'merged' | 'quiet';

const TONE_INK: Record<Tone, string> = {
  open: 'text-pr-open',
  pending: 'text-pr-pending',
  failed: 'text-pr-failed',
  merged: 'text-pr-merged',
  quiet: 'text-content-secondary',
};

const UNDERLINE =
  'underline-offset-4 decoration-1 hover:underline focus-visible:underline data-popup-open:underline';

export const POPUP_STILL = 'duration-0 data-open:animate-none data-closed:animate-none';

const STATE_TONE: Record<PrCardState, Tone> = {
  open: 'open',
  'review-pass': 'open',
  queued: 'open',
  'checks-running': 'pending',
  'review-pending': 'pending',
  behind: 'pending',
  'merge-blocked': 'pending',
  'owner-route': 'pending',
  'checks-failed': 'failed',
  conflicts: 'failed',
  'review-block': 'failed',
  closed: 'failed',
  merged: 'merged',
  draft: 'quiet',
};

const GLYPH_TONE: Record<PrPanelRow['state'], Tone> = {
  open: 'open',
  draft: 'quiet',
  merged: 'merged',
  closed: 'failed',
};

const STATE_ICON = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
} as const;

const CHIP = 'inline-flex min-w-0 items-center gap-1.5 outline-none';

const OPTICAL_NUDGE: Partial<Record<PrPanelRow['state'], string>> = {
  draft: '0.5px -0.25px',
  merged: '1px -1px',
};

export function PrGlyph({ state }: { state: PrPanelRow['state'] }) {
  const Icon = STATE_ICON[state];
  return (
    <Icon
      aria-hidden
      className={cn('size-4 flex-none stroke-2!', TONE_INK[GLYPH_TONE[state]])}
      style={{ translate: OPTICAL_NUDGE[state] }}
    />
  );
}

function Diffstat({ pr }: { pr: PrPanelRow }) {
  return (
    <span className="flex flex-none gap-1.5 text-meta tabular-nums">
      <span className="text-pr-open">+{pr.additions}</span>
      <span className="text-pr-failed">−{pr.deletions}</span>
    </span>
  );
}

function repoName(pr: PrPanelRow): string {
  return `${pr.repo.split('/').at(-1)} #${pr.number}`;
}

function OpenPr({ pr, now, grow }: { pr: PrPanelRow; now: number; grow: boolean }) {
  const { t } = useI18n();
  const card = useWarmHoverCard();
  const model = prCardModelOfRow(pr, now);
  const pill = pillOf(model, t);
  const tone = STATE_TONE[model.state];
  const checks = prChecksText(pr.checks);
  return (
    <Popover {...card.root}>
      <PopoverTrigger
        openOnHover
        delay={0}
        onPointerLeave={card.onPointerLeave}
        nativeButton={false}
        role="link"
        render={<a href={pr.url} target="_blank" rel="noreferrer" />}
        data-slot="task-pr"
        data-state={pr.state}
        data-tone={tone}
        data-grow={grow ? '' : undefined}
        className={cn(CHIP, 'group/chip', grow && 'grow-enter')}
      >
        <PrGlyph state={pr.state} />
        <span className="min-w-0 truncate">
          <span className="text-foreground tabular-nums decoration-1 underline-offset-4 group-hover/chip:underline group-focus-visible/chip:underline group-data-popup-open/chip:underline">
            #{pr.number}
          </span>
          <span className={cn('transition-colors duration-(--dur-fast)', TONE_INK[tone])}>
            {' '}
            — {pill.label}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        sideOffset={60}
        className={cn('w-80 gap-2 p-3.5', POPUP_STILL)}
        keepMounted
      >
        <div className="flex items-center gap-2 text-meta text-content-tertiary">
          <PrGlyph state={pr.state} />
          <span className="truncate tabular-nums">{repoName(pr)}</span>
          <span className={cn('ml-auto flex-none', TONE_INK[tone])}>{pill.label}</span>
        </div>
        <p className="m-0 line-clamp-2 text-ui text-foreground">{pr.title}</p>
        <div className="flex items-center gap-3 text-meta text-content-tertiary">
          <Diffstat pr={pr} />
          {checks !== null && (
            <span className="tabular-nums">{t('检查 {checks}', { checks })}</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function useCountBump(count: number): number {
  const last = useRef(count);
  const bumps = useRef(0);
  if (count > last.current) bumps.current += 1;
  last.current = count;
  return bumps.current;
}

function MergedPrs({ prs }: { prs: readonly PrPanelRow[] }) {
  const { t } = useI18n();
  const card = useWarmHoverCard();
  const bump = useCountBump(prs.length);
  const [only] = prs;
  if (prs.length === 1 && only !== undefined) {
    return (
      <a
        href={only.url}
        target="_blank"
        rel="noreferrer"
        data-slot="task-pr"
        data-state="merged"
        title={only.title}
        className={cn(CHIP, UNDERLINE, 'flex-none text-content-secondary tabular-nums')}
      >
        <PrGlyph state="merged" />#{only.number}
      </a>
    );
  }
  return (
    <Popover {...card.root}>
      <PopoverTrigger
        openOnHover
        delay={0}
        onPointerLeave={card.onPointerLeave}
        data-slot="task-pr-merged"
        className={cn(CHIP, UNDERLINE, 'flex-none text-content-secondary')}
      >
        <span key={bump} className={cn(CHIP, bump > 0 && 'grow-flash')}>
          <PrGlyph state="merged" />
          {t('{n} 个已合并', { n: prs.length })}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        sideOffset={60}
        className={cn('max-h-96 w-88 gap-0 overflow-y-auto p-1.5', POPUP_STILL)}
        keepMounted
      >
        {prs.map((pr) => (
          <a
            key={pr.buildId}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-0.5 rounded-(--radius-control) px-2.5 py-2 outline-none hover:bg-(--menu-hover) focus-visible:bg-(--menu-hover)"
          >
            <span className="truncate text-ui text-foreground">{pr.title}</span>
            <span className="flex items-center gap-1.5 text-meta text-content-tertiary">
              <PrGlyph state="merged" />
              <span className="truncate tabular-nums">
                <span className="text-pr-merged">{t('已合并')}</span> · {repoName(pr)}
              </span>
              <span className="ml-auto">
                <Diffstat pr={pr} />
              </span>
            </span>
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const NO_ARRIVALS: ReadonlySet<string> = new Set();

export function TaskPrLine({
  prs,
  now,
  arrived = NO_ARRIVALS,
}: {
  prs: readonly PrPanelRow[];
  now: number;
  arrived?: ReadonlySet<string>;
}) {
  const live = prs.filter((pr) => pr.state !== 'merged');
  const merged = prs.filter((pr) => pr.state === 'merged');
  const [newLine] = useState(() => prs.length > 0 && prs.every((pr) => arrived.has(pr.buildId)));
  return (
    <div
      data-slot="task-pr-line"
      data-grow={newLine ? '' : undefined}
      className="relative -mt-1.5 flex min-w-0 items-center gap-2.5 pr-2.5 pb-2 pl-12 text-meta leading-6"
      style={newLine ? ({ '--grow-delay': '0ms' } as CSSProperties) : undefined}
    >
      <span
        aria-hidden
        className={cn(
          'absolute -top-1 left-6 h-4 w-4 rounded-bl-md border-b border-l border-(--tree-line)',
          newLine && 'grow-guide',
        )}
      />
      {live.map((pr) => (
        <span
          key={pr.buildId}
          className="contents"
          style={newLine ? ({ '--grow-delay': '180ms' } as CSSProperties) : undefined}
        >
          <OpenPr pr={pr} now={now} grow={arrived.has(pr.buildId)} />
        </span>
      ))}
      {merged.length > 0 && <MergedPrs prs={merged} />}
    </div>
  );
}

export function TaskPrLineSkeleton() {
  return (
    <div
      data-slot="task-pr-line-skeleton"
      aria-hidden
      className="relative -mt-1.5 flex items-center gap-2.5 pr-2.5 pb-2 pl-12 leading-6"
    >
      <span className="absolute -top-1 left-6 h-4 w-4 rounded-bl-md border-b border-l border-(--tree-line)" />
      <span className="h-3.5 w-32 rounded-sm bg-muted" />
      <span className="h-3.5 w-16 rounded-sm bg-muted" />
    </div>
  );
}
