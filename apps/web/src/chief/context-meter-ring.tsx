import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

export const MOCK_CONTEXT_PERCENT = 5;

export const CONTEXT_RESUME_STATES = ['warm', 'cold', 'compacted', 'idle'] as const;
export type ContextResumeState = (typeof CONTEXT_RESUME_STATES)[number];

const CONTEXT_RESUME_SHORT: Record<ContextResumeState, string> = {
  warm: '暖',
  cold: '冷·将精简',
  compacted: '已压实',
  idle: '空闲',
};

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

export function contextResumeOf(context: unknown): ContextResumeState | null {
  if (context == null || typeof context !== 'object') return null;
  const resume = (context as { resume?: unknown }).resume;
  if (typeof resume !== 'string') return null;
  return (CONTEXT_RESUME_STATES as readonly string[]).includes(resume)
    ? (resume as ContextResumeState)
    : null;
}

export function contextResumeShortLabel(resume: ContextResumeState): string {
  return CONTEXT_RESUME_SHORT[resume];
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

function contextMeterLabel(
  t: TFunc,
  filled: number,
  mock: boolean,
  resume: ContextResumeState | null,
): string {
  const short = resume != null ? t(CONTEXT_RESUME_SHORT[resume]) : null;
  if (short != null) {
    return mock
      ? t('{state} · {percent}%（示意）', { state: short, percent: filled })
      : t('{state} · {percent}%', { state: short, percent: filled });
  }
  return mock
    ? t('上下文 {percent}%（示意）', { percent: filled })
    : t('上下文 {percent}%', { percent: filled });
}

export function ContextMeterGlyph({ filled }: { filled: number }) {
  const arc = contextMeterArcPath(filled);
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
        />
      )}
    </svg>
  );
}

export type ContextMeterRingProps = {
  percent?: number;
  mock?: boolean;
  resume?: ContextResumeState | null;
};

export function ContextMeterRing({
  percent = MOCK_CONTEXT_PERCENT,
  mock = true,
  resume = null,
}: ContextMeterRingProps) {
  const { t } = useI18n();
  const filled = clampContextPercent(percent);
  return (
    <IconTooltip
      label={contextMeterLabel(t, filled, mock, resume)}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          type="button"
          data-testid="composer-context-meter"
          data-mock={mock ? '' : undefined}
          data-percent={filled}
          data-resume={resume ?? undefined}
          className={METER_BTN_CLS}
        />
      }
    >
      <ContextMeterGlyph filled={filled} />
      <span aria-hidden="true">{`${filled}%`}</span>
    </IconTooltip>
  );
}

export function ContextMeterLine({
  percent = MOCK_CONTEXT_PERCENT,
  mock = true,
  resume = null,
}: ContextMeterRingProps) {
  const { t } = useI18n();
  const filled = clampContextPercent(percent);
  return (
    <div
      data-testid="composer-context-meter"
      data-mock={mock ? '' : undefined}
      data-percent={filled}
      data-resume={resume ?? undefined}
      className="flex h-8 items-center gap-2.5 px-2.5 text-meta tabular-nums text-content-tertiary"
    >
      <ContextMeterGlyph filled={filled} />
      {contextMeterLabel(t, filled, mock, resume)}
    </div>
  );
}
