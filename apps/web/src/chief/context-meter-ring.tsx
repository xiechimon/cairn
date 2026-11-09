import { useChief } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

export const MOCK_CONTEXT_PERCENT = 5;

const METER_BTN_CLS =
  "size-7 cursor-default rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground [&_svg:not([class*='size-'])]:size-auto";

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
  if (context == null || context.contextWindow <= 0 || !Number.isFinite(context.tokens)) {
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

export type ContextMeterRingProps = {
  percent?: number;
  mock?: boolean;
};

export function ContextMeterRing({ percent, mock }: ContextMeterRingProps) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const chiefQ = useChief(teamId, live);
  const realPercent = contextPercentOf(chiefQ.data?.context);
  const resolvedMock = mock ?? realPercent == null;
  const filled = clampContextPercent(percent ?? realPercent ?? MOCK_CONTEXT_PERCENT);
  const arc = contextMeterArcPath(filled);
  const label = resolvedMock
    ? t('上下文 {percent}%（示意）', { percent: filled })
    : t('上下文 {percent}%', { percent: filled });
  return (
    <IconTooltip
      label={label}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          type="button"
          data-testid="composer-context-meter"
          data-mock={resolvedMock ? '' : undefined}
          data-percent={filled}
          className={METER_BTN_CLS}
        />
      }
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" className="size-5.5">
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
            className="text-foreground"
          />
        )}
      </svg>
    </IconTooltip>
  );
}
