import type { ComputerRecord } from '@cairn/shared';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import type { useComputerControl } from '../api/use-computer-control.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { X } from '../icons/index.js';
import { MachineScreenSurface } from './computer-screen.js';

export type ComputerControl = ReturnType<typeof useComputerControl>;

export function ComputerControlBar({
  held,
  busy,
  handoff,
  compact = false,
  onTakeOver,
  onGiveBack,
}: {
  compact?: boolean;
  handoff: ComputerRecord['handoffReason'];
  held: boolean;
  busy: boolean;
  onTakeOver: () => void;
  onGiveBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="computer-control-bar"
      data-held={held ? 'true' : 'false'}
      data-handoff={handoff ?? 'none'}
      className={cn(
        'flex items-center gap-3',
        compact ? 'flex-none' : 'justify-between px-2.5 py-2',
      )}
    >
      {!compact && (
        <span
          className={cn(
            'text-meta',
            !held && handoff !== null ? 'text-foreground' : 'text-content-tertiary',
          )}
        >
          {held
            ? t('你在操作，Coordinator 已暂停')
            : handoff !== null
              ? t('需要你登录')
              : t('只看，不能点')}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-coarse:h-11 pointer-coarse:px-4"
        disabled={busy}
        onClick={held ? onGiveBack : onTakeOver}
      >
        {held ? t('交还') : t('接管')}
      </Button>
    </div>
  );
}

export function ComputerScreenDialog({
  open,
  onClose,
  title,
  teamId,
  computer,
  control,
  status,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  teamId: string;
  computer: ComputerRecord;
  control: ComputerControl;
  status?: ReactNode;
}) {
  const { t } = useI18n();
  const { leaseId } = control;
  return (
    <DialogShell
      bare
      open={open}
      onClose={onClose}
      title={title}
      width="min(100vw - 1.5rem, 1280px)"
      height="min(100dvh - 1.5rem - env(safe-area-inset-top) - env(safe-area-inset-bottom), 900px)"
      className="flex max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col"
    >
      <div className="relative flex shrink-0 items-start gap-3 px-4 pt-4 pr-12 pb-2 sm:px-5 sm:pt-4.5 sm:pr-13 pointer-coarse:pr-15">
        <div className="min-w-0 flex-1">
          <div className="font-heading text-heading leading-[1.4] font-title text-foreground">
            {title}
          </div>
          <p className="mt-0.5 text-meta text-content-tertiary">
            {status ?? (leaseId !== null ? t('在大屏里点击和键入') : t('接管后才能点击和键入'))}
          </p>
        </div>
        <ComputerControlBar
          compact
          held={control.controlHeld}
          busy={control.busy}
          handoff={computer.handoffReason}
          onTakeOver={() => control.setHeld(true)}
          onGiveBack={() => control.setHeld(false)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3 text-content-tertiary hover:text-foreground sm:top-4 sm:right-4 pointer-coarse:top-2 pointer-coarse:right-1.5 pointer-coarse:size-11"
          aria-label={t('关闭')}
          onClick={onClose}
        >
          <X width={20} height={20} />
        </Button>
      </div>
      <div
        data-testid="machine-screen-enlarged"
        className="grid min-h-0 flex-1 place-items-center px-2 pb-2 sm:px-3 sm:pb-3"
        style={{ containerType: 'size' }}
      >
        <div
          className="max-h-full max-w-full"
          style={{
            aspectRatio: '16 / 10',
            width: 'min(100cqw, calc(100cqh * 16 / 10))',
            height: 'min(100cqh, calc(100cqw * 10 / 16))',
          }}
        >
          <MachineScreenSurface
            teamId={teamId}
            computer={computer}
            leaseId={leaseId}
            interactive={leaseId !== null}
            fill
            autoFocus
          />
        </div>
      </div>
    </DialogShell>
  );
}
