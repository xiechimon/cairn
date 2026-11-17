import type { ComputerRecord } from '@cairn/shared';
import { cn } from 'cn';
import { Minimize2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { useComputerControl } from '../api/use-computer-control.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { MachineName } from '../components/machine-label.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
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
      open={open}
      onClose={onClose}
      viewportRoot
      backdropClassName="bg-(--screen-letterbox)"
      zIndex="var(--z-modal)"
    >
      <div
        role="dialog"
        aria-label={title}
        data-testid="machine-screen-enlarged"
        className="fixed inset-0 z-(--z-modal) flex flex-col bg-(--screen-letterbox) pb-[env(safe-area-inset-bottom)]"
      >
        <div
          data-testid="machine-screen-chrome"
          className="machine-screen-bar flex min-h-12 flex-none items-center gap-3 border-b border-border bg-background pt-[env(safe-area-inset-top)] pr-1.5 pl-4 text-foreground"
        >
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="min-w-0 truncate text-ui text-foreground">
              <MachineName machine={{ id: computer.machine.id, name: title }} compact />
            </span>
            <span className="hidden min-w-0 truncate text-meta text-content-tertiary sm:block">
              {status ??
                (leaseId !== null ? t('你在操作，Coordinator 已暂停') : t('点画面就能接管'))}
            </span>
          </div>
          <ComputerControlBar
            compact
            held={control.controlHeld}
            busy={control.busy}
            handoff={computer.handoffReason}
            onTakeOver={() => control.setHeld(true)}
            onGiveBack={() => control.setHeld(false)}
          />
          <IconTooltip
            label={t('缩小')}
            side="bottom"
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-testid="machine-screen-exit"
                className="flex-none text-content-tertiary hover:text-foreground pointer-coarse:size-11"
                aria-label={t('缩小')}
                onClick={onClose}
              />
            }
          >
            <Minimize2 aria-hidden="true" className="size-5" />
          </IconTooltip>
        </div>
        <div className="min-h-0 flex-1">
          <MachineScreenSurface
            teamId={teamId}
            computer={computer}
            leaseId={leaseId}
            interactive={leaseId !== null}
            fill
            autoFocus
            onActivate={control.busy ? undefined : () => control.setHeld(true)}
          />
        </div>
      </div>
    </DialogShell>
  );
}
