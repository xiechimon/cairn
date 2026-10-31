import { cn } from 'cn';
import { AlarmClockOff, Archive, Check, X } from 'lucide-react';
import { Button } from '../ui/button.js';

export interface BulkBarProps {
  count: number;
  onResolve?: () => void;
  onSnooze?: () => void;
  onArchive?: () => void;
  onClear?: () => void;
  className?: string;
}

const ACTION_CLS =
  'h-7 text-ui text-primary-foreground hover:bg-primary-foreground/12 hover:text-primary-foreground dark:hover:bg-primary-foreground/12';

export function BulkBar({
  count,
  onResolve,
  onSnooze,
  onArchive,
  onClear,
  className,
}: BulkBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      data-slot="bulk-bar"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-(--radius-card) bg-primary py-1.5 pr-1.5 pl-3.5 text-ui whitespace-nowrap text-primary-foreground shadow-(--e2)',
        className,
      )}
    >
      <b className="mr-1 font-semibold">{count} selected</b>
      <Button variant="ghost" onClick={onResolve} className={ACTION_CLS}>
        <Check className="size-3.5" />
        Resolve
      </Button>
      <Button variant="ghost" onClick={onSnooze} className={ACTION_CLS}>
        <AlarmClockOff className="size-3.5" />
        Snooze
      </Button>
      <Button variant="ghost" onClick={onArchive} className={ACTION_CLS}>
        <Archive className="size-3.5" />
        Archive
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Clear selection"
        onClick={onClear}
        className={ACTION_CLS}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
