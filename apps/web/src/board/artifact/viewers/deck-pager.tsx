import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconTooltip } from '../../../components/icon-tooltip.js';
import { Button } from '../../../components/ui/button.js';
import { toastError } from '../../../components/ui/toaster.js';
import { useI18n } from '../../../i18n/provider.js';

export const DECK_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  PageDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  PageUp: -1,
};

export function useFullscreen(element: HTMLElement | null): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(element !== null && document.fullscreenElement === element);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [element]);
  return on;
}

export function DeckPager({
  current,
  count,
  presenting,
  shell,
  onGo,
}: {
  current: number;
  count: number;
  presenting: boolean;
  shell: HTMLElement | null;
  onGo: (index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-(--radius-control) bg-popover p-0.5 shadow-(--e1)">
      <IconTooltip
        label={t('上一页')}
        side="top"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="artifact-deck-prev"
            disabled={current === 0}
            onClick={() => onGo(current - 1)}
          />
        }
      >
        <ChevronLeft aria-hidden className="size-4" />
      </IconTooltip>
      <span
        data-testid="artifact-deck-position"
        className="min-w-10 text-center text-meta text-content-secondary tabular-nums"
      >
        {current + 1} / {count}
      </span>
      <IconTooltip
        label={t('下一页')}
        side="top"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="artifact-deck-next"
            disabled={current === count - 1}
            onClick={() => onGo(current + 1)}
          />
        }
      >
        <ChevronRight aria-hidden className="size-4" />
      </IconTooltip>
      {!presenting && shell !== null && document.fullscreenEnabled && (
        <IconTooltip
          label={t('放映')}
          side="top"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="artifact-deck-present"
              onClick={() => {
                shell.focus({ preventScroll: true });
                shell
                  .requestFullscreen()
                  .catch((error: unknown) => toastError(t('未能全屏放映'), error));
              }}
            />
          }
        >
          <Play aria-hidden className="size-4" />
        </IconTooltip>
      )}
    </div>
  );
}
