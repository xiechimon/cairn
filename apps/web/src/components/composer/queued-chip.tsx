import { ArrowUp, Clock, X } from 'lucide-react';
import { Button } from '../ui/button.js';

export interface QueuedChipProps {
  text: string;
  onSendNow?: () => void;
  onRemove?: () => void;
}

export function QueuedChip({ text, onSendNow, onRemove }: QueuedChipProps) {
  return (
    <span
      data-slot="queued-chip"
      title="Queued: sends when the turn ends"
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-canvas pr-1 pl-2.5 text-meta text-foreground"
    >
      <Clock className="size-3 flex-none text-content-tertiary" />
      <span className="min-w-0 truncate">{text}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Send now"
        onClick={onSendNow}
        className="size-4.5 text-content-tertiary"
      >
        <ArrowUp className="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Remove"
        onClick={onRemove}
        className="size-4.5 text-content-tertiary"
      >
        <X className="size-3" />
      </Button>
    </span>
  );
}
