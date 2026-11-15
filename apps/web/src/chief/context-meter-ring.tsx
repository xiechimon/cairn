import { Button } from '../components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import type { Locale } from '../i18n/locale.js';
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

export type ContextMeterReading = { tokens: number; contextWindow: number; compactAt?: number };

function compactTokens(locale: Locale, n: number): string {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

export function contextMeterLines(
  t: TFunc,
  locale: Locale,
  context: ContextMeterReading | null,
): string[] {
  if (context == null) return [t('上下文（示意）')];
  const used = t('已用 {used} / {window}', {
    used: compactTokens(locale, context.tokens),
    window: compactTokens(locale, context.contextWindow),
  });
  if (context.compactAt === undefined) return [used];
  return [used, t('{at}时自动压缩', { at: compactTokens(locale, context.compactAt) })];
}

export function ContextMeterGlyph({ filled, busy = false }: { filled: number; busy?: boolean }) {
  const arc = contextMeterArcPath(busy ? 25 : filled);
  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      aria-hidden="true"
      className={busy ? 'size-3.5 motion-safe:animate-spin' : 'size-3.5'}
    >
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
        />
      )}
    </svg>
  );
}

export type ContextMeterRingProps = {
  context?: ContextMeterReading | null;
  busy?: boolean;
  loading?: boolean;
};

function useContextMeter(context: ContextMeterReading | null, loading: boolean) {
  const { t, locale } = useI18n();
  return {
    filled: contextPercentOf(context) ?? MOCK_CONTEXT_PERCENT,
    lines: loading ? [t('正在加载用量…')] : contextMeterLines(t, locale, context),
  };
}

export function ContextMeterRing({
  context = null,
  busy = false,
  loading = false,
}: ContextMeterRingProps) {
  const { filled, lines } = useContextMeter(context, loading);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label={lines.join(', ')}
            aria-busy={busy || loading}
            data-testid="composer-context-meter"
            data-mock={context == null ? '' : undefined}
            data-percent={filled}
            className={METER_BTN_CLS}
          />
        }
      >
        <ContextMeterGlyph filled={filled} busy={busy || loading} />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className="flex-col items-start gap-0.5">
        {lines.map((line, index) => (
          <span key={line} className={index === 0 ? undefined : 'opacity-80'}>
            {line}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

export function ContextMeterLine({
  context = null,
  busy = false,
  loading = false,
}: ContextMeterRingProps) {
  const { filled, lines } = useContextMeter(context, loading);
  return (
    <div
      data-testid="composer-context-meter"
      aria-busy={busy || loading}
      data-mock={context == null ? '' : undefined}
      data-percent={filled}
      className="flex h-8 items-center gap-2.5 px-2.5 text-meta tabular-nums text-content-tertiary"
    >
      <ContextMeterGlyph filled={filled} busy={busy || loading} />
      {lines.join(' · ')}
    </div>
  );
}
