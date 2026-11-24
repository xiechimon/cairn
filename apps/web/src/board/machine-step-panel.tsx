import type { ComputerStep } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

const SHOT_RATIO = 16 / 10;

function shotSrc(callId: string): string {
  return `/api/computers/steps/${callId}/shot`;
}

function useLoadedSrc(src: string | null): string | null {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (src === null) {
      setShown(null);
      return;
    }
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live) setShown(src);
    };
    image.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return shown;
}

function imageBox(width: number, height: number) {
  const ratio = width / height;
  return ratio >= SHOT_RATIO
    ? {
        left: 0,
        width: 100,
        height: (SHOT_RATIO / ratio) * 100,
        top: (100 - (SHOT_RATIO / ratio) * 100) / 2,
      }
    : {
        top: 0,
        height: 100,
        width: (ratio / SHOT_RATIO) * 100,
        left: (100 - (ratio / SHOT_RATIO) * 100) / 2,
      };
}

function StepShot({
  shot,
  label,
  onWatch,
}: {
  shot: NonNullable<ComputerStep['shot']>;
  label: string;
  onWatch: (() => void) | null;
}) {
  const shown = useLoadedSrc(shotSrc(shot.callId));
  const box = imageBox(shot.width, shot.height);
  const frame = (
    <span
      data-testid="machine-step-shot"
      className="relative block aspect-[16/10] w-full overflow-hidden rounded-(--radius-tile) border border-border bg-(--surface-1)"
    >
      {shown !== null && (
        <span
          className="absolute"
          style={{
            left: `${box.left}%`,
            top: `${box.top}%`,
            width: `${box.width}%`,
            height: `${box.height}%`,
          }}
        >
          <img alt="" src={shown} decoding="async" className="block size-full" />
          {shot.point !== null && (
            <span
              aria-hidden="true"
              data-testid="machine-step-click"
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/80 ring-2 ring-background"
              style={{
                left: `${(shot.point.x / shot.width) * 100}%`,
                top: `${(shot.point.y / shot.height) * 100}%`,
              }}
            />
          )}
        </span>
      )}
    </span>
  );
  if (onWatch === null) return frame;
  return (
    <Button
      variant="ghost"
      data-testid="machine-step-watch"
      aria-label={label}
      title={label}
      className="block h-auto w-full cursor-pointer rounded-(--radius-tile) p-0 hover:bg-transparent dark:hover:bg-transparent"
      onClick={onWatch}
    >
      {frame}
    </Button>
  );
}

export function MachineStepPanel({
  step,
  noScreenPermission,
  settingsHref,
  onWatch,
  growOnMount,
}: {
  step: ComputerStep;
  noScreenPermission: boolean;
  settingsHref: string | null;
  onWatch: (() => void) | null;
  growOnMount: boolean;
}) {
  const { t } = useI18n();
  const [grow] = useState(growOnMount);
  const missing =
    step.shot === null && (step.shotMissing || (step.surface !== 'browser' && noScreenPermission));
  if (step.shot === null && !missing) return null;
  return (
    <div
      data-testid="machine-step"
      data-in-flight={step.inFlight ? 'true' : 'false'}
      className={cn('flex flex-col gap-2 border-t border-border px-4 py-3', grow && 'grow-enter')}
    >
      {step.shot !== null && <StepShot shot={step.shot} label={t('查看屏幕')} onWatch={onWatch} />}
      {missing && (
        <span
          data-testid="machine-step-no-shot"
          className="truncate text-meta text-content-tertiary"
        >
          {noScreenPermission
            ? t('缺少屏幕录制权限，看不到画面')
            : t('没有截到画面，确认电脑已解锁')}
          {settingsHref !== null && (
            <>
              {' '}
              <Link
                to={settingsHref}
                className="rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {t('打开设置')}
              </Link>
            </>
          )}
        </span>
      )}
    </div>
  );
}
