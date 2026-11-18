import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { cacheHitShare } from '../api/mappers.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import type { ChiefContextUsage } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

export const MOCK_CONTEXT_PERCENT = 5;

export const METER_BTN_CLS =
  'h-7 w-auto gap-1.5 px-1.5 pointer-coarse:h-11 cursor-default rounded-(--radius-control) text-caption font-normal tabular-nums text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--text-secondary) dark:hover:bg-(--menu-hover) dark:hover:text-(--text-secondary)';

const VIEW = 24;
const STROKE = 3;
const RADIUS = (VIEW - STROKE) / 2;
const CX = VIEW / 2;
const CY = VIEW / 2;
const NEAR_COMPACTION = 0.9;

export function clampContextPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function contextPercentOf(
  context: { tokens: number; contextWindow: number } | null | undefined,
): number | null {
  if (
    context == null ||
    !Number.isFinite(context.tokens) ||
    !Number.isFinite(context.contextWindow) ||
    context.contextWindow <= 0
  ) {
    return null;
  }
  return clampContextPercent((100 * context.tokens) / context.contextWindow);
}

export function contextMeterArcPath(percent: number, cx = CX, cy = CY, radius = RADIUS): string {
  const filled = clampContextPercent(percent);
  if (filled <= 0) return '';
  const startX = cx;
  const startY = cy - radius;
  if (filled >= 100) {
    return `M ${startX} ${startY} A ${radius} ${radius} 0 1 1 ${startX - 0.001} ${startY}`;
  }
  const angle = (filled / 100) * Math.PI * 2 - Math.PI / 2;
  const endX = cx + radius * Math.cos(angle);
  const endY = cy + radius * Math.sin(angle);
  const largeArc = filled > 50 ? 1 : 0;
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;
}

export type ContextMeterReading = ChiefContextUsage;

export function formatContextTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const fraction = n >= 10_000 && n < 1_000_000 ? 0 : 1;
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: fraction,
  }).format(n);
}

export function contextNearCompaction(context: ContextMeterReading | null): boolean {
  return context?.compactAt !== undefined && context.tokens >= context.compactAt * NEAR_COMPACTION;
}

export type ContextCacheState =
  | { kind: 'running' }
  | { kind: 'cold' }
  | { kind: 'expired' }
  | { kind: 'warm'; leftMs: number };

export function contextCacheState(
  context: ContextMeterReading | null,
  running: boolean,
  now: number,
): ContextCacheState | null {
  if (context == null) return null;
  if (context.resume === 'cold') return { kind: 'cold' };
  if (context.resumeExpiresAt === undefined) return null;
  if (running) return { kind: 'running' };
  const leftMs = context.resumeExpiresAt - now;
  return leftMs > 0 ? { kind: 'warm', leftMs } : { kind: 'expired' };
}

function cacheTooltip(t: TFunc, state: ContextCacheState): string {
  if (state.kind === 'running') return t('Cache 回复中保持有效');
  if (state.kind === 'cold') return t('Cache 换了模型，下一条不命中');
  if (state.kind === 'expired') return t('Cache 已失效');
  if (state.leftMs < 60_000) return t('Cache 不到 1 分钟后失效');
  return t('Cache {n} 分钟后失效', { n: Math.ceil(state.leftMs / 60_000) });
}

function cachePanelValue(t: TFunc, state: ContextCacheState): string {
  if (state.kind === 'running') return t('回复中保持有效');
  if (state.kind === 'cold') return t('下一条不命中');
  if (state.kind === 'expired') return t('已失效');
  const seconds = Math.ceil(state.leftMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return t('{time} 后失效', { time: clock });
}

export function contextMeterLines(
  t: TFunc,
  context: ContextMeterReading | null,
  options: { running?: boolean; now?: number } = {},
): string[] {
  if (context == null) return [t('上下文（示意）')];
  const lines = [
    t('Context {used} / {window}', {
      used: formatContextTokens(context.tokens),
      window: formatContextTokens(context.contextWindow),
    }),
  ];
  if (context.compactAt !== undefined) {
    lines.push(
      contextNearCompaction(context)
        ? t('再用 {left} 就 auto-compact', {
            left: formatContextTokens(Math.max(0, context.compactAt - context.tokens)),
          })
        : t('{at} 时 auto-compact', { at: formatContextTokens(context.compactAt) }),
    );
  }
  const cache = contextCacheState(context, options.running ?? false, options.now ?? Date.now());
  if (cache !== null) lines.push(cacheTooltip(t, cache));
  return lines;
}

function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [active]);
  return now;
}

export function useContextClock(context: ContextMeterReading | null): number {
  return useClock(context?.resumeExpiresAt !== undefined && context.resumeExpiresAt > Date.now());
}

export function ContextMeterGlyph({
  filled,
  compactShare,
  near = false,
}: {
  filled: number;
  compactShare?: number | undefined;
  near?: boolean;
}) {
  const arc = contextMeterArcPath(filled);
  const tick =
    compactShare === undefined || compactShare <= 0 || compactShare >= 1
      ? null
      : compactShare * Math.PI * 2 - Math.PI / 2;
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" className="size-3.5">
      <circle
        cx={CX}
        cy={CY}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        opacity={0.28}
      />
      {arc !== '' && (
        <path
          d={arc}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className={near ? 'text-foreground' : undefined}
        />
      )}
      {tick !== null && (
        <line
          data-compact-tick=""
          x1={CX + (RADIUS - 3.2) * Math.cos(tick)}
          y1={CY + (RADIUS - 3.2) * Math.sin(tick)}
          x2={CX + (RADIUS + 3.2) * Math.cos(tick)}
          y2={CY + (RADIUS + 3.2) * Math.sin(tick)}
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function contextGlyphProps(context: ContextMeterReading | null, filled: number) {
  return {
    filled,
    compactShare:
      context?.compactAt === undefined ? undefined : context.compactAt / context.contextWindow,
    near: contextNearCompaction(context),
  };
}

export function ContextMeterPanel({
  context,
  running = false,
  now,
  className,
}: {
  context: ContextMeterReading;
  running?: boolean;
  now: number;
  className?: string;
}) {
  const { t } = useI18n();
  const near = contextNearCompaction(context);
  const fill = Math.min(100, (100 * context.tokens) / context.contextWindow);
  const tick =
    context.compactAt === undefined
      ? null
      : Math.min(100, (100 * context.compactAt) / context.contextWindow);
  const cache = contextCacheState(context, running, now);
  const hit =
    context.cache === undefined
      ? null
      : cacheHitShare({
          input: context.cache.input,
          cacheRead: context.cache.read,
          cacheWrite: context.cache.write,
        });
  const rows = [
    context.compactAt === undefined
      ? null
      : {
          id: 'compact',
          label: 'Auto-compact',
          value: near
            ? t('{at} · 还剩 {left}', {
                at: formatContextTokens(context.compactAt),
                left: formatContextTokens(Math.max(0, context.compactAt - context.tokens)),
              })
            : formatContextTokens(context.compactAt),
        },
    cache === null ? null : { id: 'cache', label: 'Cache', value: cachePanelValue(t, cache) },
    hit === null ? null : { id: 'hit', label: 'Hit rate', value: `${Math.round(hit * 100)}%` },
  ].filter((row) => row !== null);
  return (
    <section
      data-testid="context-panel"
      aria-label="Context"
      className={cn('flex min-w-0 flex-col text-ui', className)}
    >
      <div className="flex items-baseline justify-between gap-4 font-medium text-foreground">
        <h3 className="m-0 text-ui font-medium">Context</h3>
        <span data-testid="context-panel-reading" className="tabular-nums">
          {`${formatContextTokens(context.tokens)} / ${formatContextTokens(context.contextWindow)}`}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="relative mt-1.5 mb-2 h-1.5 rounded-full bg-(--menu-hover) shadow-[inset_0_0_0_1px_var(--border)]"
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            near ? 'bg-foreground' : 'bg-content-tertiary',
          )}
          style={{ width: `${fill}%` }}
        />
        {tick !== null && (
          <div
            data-compact-tick=""
            className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: `${tick}%` }}
          />
        )}
      </div>
      <dl className="m-0 flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.id}
            data-testid={`context-panel-${row.id}`}
            className="flex items-baseline justify-between gap-4"
          >
            <dt className="text-content-secondary">{row.label}</dt>
            <dd className="m-0 whitespace-nowrap text-foreground tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export type ContextMeterRingProps = {
  context?: ContextMeterReading | null;
  running?: boolean;
  loading?: boolean;
};

export function ContextMeterRing({
  context = null,
  running = false,
  loading = false,
}: ContextMeterRingProps) {
  const { t } = useI18n();
  const now = useContextClock(context);
  const filled = contextPercentOf(context) ?? MOCK_CONTEXT_PERCENT;
  const lines = loading ? [t('正在加载用量…')] : contextMeterLines(t, context, { running, now });
  const openable = !loading && context != null;
  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      aria-label={lines.join(', ')}
      aria-busy={loading}
      data-testid="composer-context-meter"
      data-mock={context == null ? '' : undefined}
      data-percent={filled}
      className={cn(METER_BTN_CLS, openable && 'cursor-pointer aria-expanded:bg-(--menu-hover)')}
    />
  );
  const glyph = <ContextMeterGlyph {...contextGlyphProps(context, loading ? 0 : filled)} />;
  const tip = (
    <TooltipContent side="top" sideOffset={8} className="flex-col items-start gap-0.5">
      {lines.map((line, index) => (
        <span key={line} className={index === 0 ? undefined : 'opacity-80'}>
          {line}
        </span>
      ))}
    </TooltipContent>
  );
  if (!openable) {
    return (
      <Tooltip>
        <TooltipTrigger render={trigger}>{glyph}</TooltipTrigger>
        {tip}
      </Tooltip>
    );
  }
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={trigger} />}>{glyph}</TooltipTrigger>
        {tip}
      </Tooltip>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-65 p-3.5">
        <ContextMeterPanel context={context} running={running} now={now} />
      </PopoverContent>
    </Popover>
  );
}

export function ContextMeterLine({
  context = null,
  running = false,
  loading = false,
}: ContextMeterRingProps) {
  const { t } = useI18n();
  const now = useContextClock(context);
  const filled = contextPercentOf(context) ?? MOCK_CONTEXT_PERCENT;
  if (!loading && context != null) {
    return (
      <div data-testid="composer-context-meter" data-percent={filled} aria-busy={false}>
        <ContextMeterPanel context={context} running={running} now={now} className="px-2.5 py-2" />
      </div>
    );
  }
  const lines = loading ? [t('正在加载用量…')] : contextMeterLines(t, context);
  return (
    <div
      data-testid="composer-context-meter"
      aria-busy={loading}
      data-mock={context == null ? '' : undefined}
      data-percent={filled}
      className="flex h-8 items-center gap-2.5 px-2.5 text-meta tabular-nums text-content-tertiary"
    >
      <ContextMeterGlyph filled={loading ? 0 : filled} />
      {lines.join(' · ')}
    </div>
  );
}
