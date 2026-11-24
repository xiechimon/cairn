import { Minus, Plus } from 'lucide-react';
import { IconTooltip } from '../../../components/icon-tooltip.js';
import { Button } from '../../../components/ui/button.js';
import { useI18n } from '../../../i18n/provider.js';
import { TOOL_BUTTON } from '../artifact-toolbar.js';

export type Zoom = 'fit' | number;

const STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function stepZoom(current: number, direction: 1 | -1): number {
  const MIN = 0.25;
  const MAX = 4;
  if (direction > 0) return STEPS.find((step) => step > current + 0.001) ?? MAX;
  return [...STEPS].reverse().find((step) => step < current - 0.001) ?? MIN;
}

export function ZoomControl({
  zoom,
  fitScale,
  onChange,
}: {
  zoom: Zoom;
  fitScale: number;
  onChange: (next: Zoom) => void;
}) {
  const { t } = useI18n();
  const scale = zoom === 'fit' ? fitScale : zoom;
  return (
    <div data-testid="artifact-zoom" className="flex items-center gap-0.5">
      <IconTooltip
        label={t('缩小')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="artifact-zoom-out"
            onClick={() => onChange(stepZoom(scale, -1))}
            className={`${TOOL_BUTTON} w-7 px-0`}
          />
        }
      >
        <Minus aria-hidden className="size-4" />
      </IconTooltip>
      <Button
        variant="ghost"
        size="sm"
        data-testid="artifact-zoom-fit"
        aria-pressed={zoom === 'fit'}
        onClick={() => onChange(zoom === 'fit' ? 1 : 'fit')}
        className={`${TOOL_BUTTON} min-w-14 justify-center tabular-nums`}
      >
        {zoom === 'fit' ? t('适应') : `${Math.round(scale * 100)}%`}
      </Button>
      <IconTooltip
        label={t('放大')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="artifact-zoom-in"
            onClick={() => onChange(stepZoom(scale, 1))}
            className={`${TOOL_BUTTON} w-7 px-0`}
          />
        }
      >
        <Plus aria-hidden className="size-4" />
      </IconTooltip>
    </div>
  );
}
