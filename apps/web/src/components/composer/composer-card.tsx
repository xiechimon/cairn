import { cn } from 'cn';
import { ArrowUp, Plus, Square, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Kbd } from '../ui/kbd.js';
import { Textarea } from '../ui/textarea.js';
import { QueuedChip } from './queued-chip.js';

export interface ComposerCardProps {
  value: string;
  onValueChange: (next: string) => void;
  placeholder: string;
  model: string;
  effort: string;
  queued?: readonly string[];
  onSendQueued?: (index: number) => void;
  onRemoveQueued?: (index: number) => void;
  running?: boolean;
  steer?: boolean;
  error?: string;
  onSend?: () => void;
  onStop?: () => void;
  onAttach?: () => void;
  className?: string;
}

export function ComposerCard({
  value,
  onValueChange,
  placeholder,
  model,
  effort,
  queued = [],
  onSendQueued,
  onRemoveQueued,
  running = false,
  steer = false,
  error,
  onSend,
  onStop,
  onAttach,
  className,
}: ComposerCardProps) {
  return (
    <div data-slot="composer-card" className={cn('flex flex-col gap-1.5', className)}>
      {error != null && (
        <p role="alert" className="m-0 flex items-center gap-1.5 text-meta text-destructive">
          <TriangleAlert className="size-3.5 flex-none" />
          {error}
        </p>
      )}
      <div
        className={cn(
          'rounded-(--radius-composer) bg-card pt-3 pr-3 pb-2 pl-4 transition-shadow duration-(--dur-fast)',
          error != null
            ? 'shadow-[0_0_0_1px_var(--danger-line),0_0_0_4px_var(--danger-soft)]'
            : 'shadow-(--shadow-composer) focus-within:shadow-(--shadow-composer-focus)',
        )}
      >
        {queued.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {queued.map((text, index) => (
              <QueuedChip
                key={text}
                text={text}
                onSendNow={() => onSendQueued?.(index)}
                onRemove={() => onRemoveQueued?.(index)}
              />
            ))}
          </div>
        )}
        <Textarea
          rows={2}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          className="min-h-0 resize-none border-0 bg-transparent p-0 text-ui shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Attach"
            onClick={onAttach}
            className="text-content-tertiary"
          >
            <Plus />
          </Button>
          <span className="ml-auto text-meta text-content-secondary">
            {model} <span className="text-content-tertiary">{effort}</span>
          </span>
          <span className="hidden items-center gap-1 text-caption text-content-tertiary sm:inline-flex">
            {steer ? (
              <>
                <Kbd>↵</Kbd> steer · <Kbd>⌘↵</Kbd> queue
              </>
            ) : (
              <>
                <Kbd>↵</Kbd> send
              </>
            )}
          </span>
          {running ? (
            <Button variant="outline" size="icon-sm" aria-label="Stop" onClick={onStop}>
              <Square className="size-2.5 fill-current" />
            </Button>
          ) : (
            <Button size="icon-sm" aria-label="Send" onClick={onSend}>
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
