import { cn } from 'cn';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnected } from '../api/connection-state.js';
import { formatClock, useLiveSeconds } from '../components/chat/live-row.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import type { ChiefContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { useQuestionPending } from './chief-question.js';
import {
  ANNOUNCE_SETTLE_MS,
  FULL_PEN,
  finishedTurn,
  isActiveMark,
  lastTurnOf,
  MARK_DONE_MS,
  MARK_VIEWBOX,
  markPath,
  PILL_FADE_MS,
  PILL_HOLD_MS,
  STATUS_MARK_LABELS,
  type StatusMarkId,
  type StatusMarkView,
  statusMarkView,
  transitionFrame,
} from './status-mark.js';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export function StatusMarkGlyph({
  state,
  className = 'size-8',
}: {
  state: StatusMarkId;
  className?: string;
}) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const shownRef = useRef(state);
  const changedRef = useRef(Number.NEGATIVE_INFINITY);
  const mountedRef = useRef(false);
  const [initialPath] = useState(() => markPath(state, 0, FULL_PEN, true));

  useLayoutEffect(() => {
    if (mountedRef.current) changedRef.current = performance.now();
    mountedRef.current = true;
    const media = window.matchMedia(REDUCED_MOTION);
    let frame = 0;
    let painted = '';
    const paint = (now: number) => {
      const path = pathRef.current;
      if (path == null) return;
      const still = media.matches;
      const next = transitionFrame(shownRef.current, state, now - changedRef.current, still);
      shownRef.current = next.shown;
      const d = markPath(next.shown, now, next.pen, still);
      if (d !== painted) {
        path.setAttribute('d', d);
        painted = d;
      }
      if (path.dataset.mark !== next.shown) path.dataset.mark = next.shown;
    };
    const loop = (now: number) => {
      paint(now);
      if (!media.matches && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      paint(performance.now());
      if (!media.matches && !document.hidden) frame = requestAnimationFrame(loop);
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    media.addEventListener('change', resume);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', resume);
      media.removeEventListener('change', resume);
    };
  }, [state]);

  return (
    <svg aria-hidden="true" viewBox={MARK_VIEWBOX} className={className}>
      <path
        ref={pathRef}
        d={initialPath}
        data-mark={state}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-foreground data-[mark=error]:stroke-destructive data-[mark=offline]:opacity-75"
      />
    </svg>
  );
}

export function StatusMarkFloat({
  view,
  elapsed = null,
  pinned = false,
  large = false,
  className,
}: {
  view: StatusMarkView;
  elapsed?: number | null;
  pinned?: boolean;
  large?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const { id, label, announce } = view;
  const [pill, setPill] = useState({ id, label });
  const [out, setOut] = useState(false);
  const [hover, setHover] = useState(false);
  const [announced, setAnnounced] = useState(announce ? label : '');

  useEffect(() => {
    const reduce = window.matchMedia(REDUCED_MOTION).matches;
    setOut(true);
    const swap = window.setTimeout(
      () => {
        setPill({ id, label });
        setOut(false);
      },
      reduce ? 0 : PILL_FADE_MS,
    );
    const hold = pinned ? 0 : window.setTimeout(() => setOut(true), PILL_HOLD_MS);
    return () => {
      window.clearTimeout(swap);
      window.clearTimeout(hold);
    };
  }, [id, label, pinned]);

  useEffect(() => {
    const settle = window.setTimeout(() => setAnnounced(announce ? label : ''), ANNOUNCE_SETTLE_MS);
    return () => window.clearTimeout(settle);
  }, [label, announce]);

  const visible = pill.label !== '' && (!out || hover);
  const live = (
    <span role="status" className="sr-only" data-testid="chief-status-live">
      {announced === '' ? '' : t(announced)}
    </span>
  );
  if (large) {
    const name = label === '' ? t('Coordinator') : t(label);
    return (
      <div
        data-testid="chief-status-mark"
        data-state={id}
        className={cn('pointer-events-none flex flex-col items-center', className)}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="img"
                aria-label={name}
                data-slot="status-mark-circle"
                className="pointer-events-auto grid size-15.5 place-items-center rounded-full bg-popover shadow-(--e2)"
              />
            }
          >
            <StatusMarkGlyph state={id} className="size-11" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {elapsed == null ? name : `${name} · ${formatClock(elapsed)}`}
          </TooltipContent>
        </Tooltip>
        {live}
      </div>
    );
  }
  return (
    <div
      data-testid="chief-status-mark"
      data-state={id}
      className={cn('pointer-events-none flex flex-col items-center', className)}
    >
      <div
        data-slot="status-mark-circle"
        className="pointer-events-auto grid size-11 place-items-center rounded-full bg-popover shadow-(--e2)"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <StatusMarkGlyph state={id} className="size-8" />
      </div>
      <div
        aria-hidden="true"
        data-testid="chief-status-pill"
        data-visible={visible}
        className={cn(
          '-mt-1 flex items-center gap-2 rounded-full bg-popover px-3 py-1.75 text-meta leading-5 font-medium whitespace-nowrap text-foreground shadow-(--e2) transition-[opacity,transform] duration-(--dur-fast) ease-out motion-reduce:transition-none',
          !visible && '-translate-y-1 opacity-0',
        )}
      >
        {pill.id === 'ask' && <span className="size-1.5 rounded-full bg-(--waiting-ink)" />}
        {pill.label === '' ? '' : t(pill.label)}
        {hover && elapsed != null && (
          <span className="font-normal text-(--text-tertiary) tabular-nums">
            · {formatClock(elapsed)}
          </span>
        )}
      </div>
      {live}
    </div>
  );
}

const DONE_VIEW: StatusMarkView = { id: 'done', label: STATUS_MARK_LABELS.done, announce: true };

export function ChiefStatusMark({
  chief,
  large = false,
  className = 'absolute inset-x-0 top-2.5 z-10',
}: {
  chief: ChiefContent;
  large?: boolean;
  className?: string;
}) {
  const connected = useConnected();
  const questionPending = useQuestionPending();
  const base = statusMarkView({ chief, questionPending, connected });
  const stream = chief.stream ?? [];
  const lastTurn = lastTurnOf(stream);
  const sawActiveRef = useRef(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (isActiveMark(base.id)) sawActiveRef.current = true;
    if (!finishedTurn(sawActiveRef.current, base.id, lastTurn)) {
      if (base.id !== 'idle') setDone(false);
      return;
    }
    sawActiveRef.current = false;
    setDone(true);
    const id = window.setTimeout(() => setDone(false), MARK_DONE_MS);
    return () => {
      window.clearTimeout(id);
      setDone(false);
    };
  }, [base.id, lastTurn]);
  const live =
    chief.running === true ? stream.findLast((item) => item.kind === 'streaming') : undefined;
  const elapsed = useLiveSeconds(live?.kind === 'streaming' ? live.startedAt : null);
  return (
    <StatusMarkFloat
      view={done && base.id === 'idle' ? DONE_VIEW : base}
      elapsed={elapsed}
      large={large}
      className={className}
    />
  );
}
