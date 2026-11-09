import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

export const MOCK_CONTEXT_PERCENT = 5;

const METER_BTN_CLS =
  "size-7 cursor-default rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) dark:hover:text-foreground [&_svg:not([class*='size-'])]:size-auto";

const VIEW = 24;
const STROKE = 3;
const RADIUS = (VIEW - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function clampContextPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function ContextMeterRing({
  percent = MOCK_CONTEXT_PERCENT,
  mock = true,
}: {
  percent?: number;
  mock?: boolean;
}) {
  const { t } = useI18n();
  const filled = clampContextPercent(percent);
  const dash = (filled / 100) * CIRCUMFERENCE;
  const label = mock
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
          data-mock={mock ? '' : undefined}
          data-percent={filled}
          className={METER_BTN_CLS}
        />
      }
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" className="size-5.5 -rotate-90">
        <circle
          cx={VIEW / 2}
          cy={VIEW / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          opacity={0.28}
        />
        <circle
          cx={VIEW / 2}
          cy={VIEW / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          className="text-foreground"
        />
      </svg>
    </IconTooltip>
  );
}
