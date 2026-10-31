import { cn } from 'cn';
import { Check, Lock, X } from 'lucide-react';
import { Button } from '../ui/button.js';

export type PermissionChoice = 'deny' | 'once' | 'always';

export interface PermissionCardProps {
  title: string;
  command: string;
  help?: string;
  alwaysLabel: string;
  resolution?: PermissionChoice | null;
  resolvedBy?: string;
  resolvedAt?: string;
  onChoose?: (choice: PermissionChoice) => void;
  className?: string;
}

const RESOLVED_LABEL: Record<PermissionChoice, string> = {
  deny: 'Denied',
  once: 'Allowed once',
  always: 'Always allowed',
};

export function PermissionCard({
  title,
  command,
  help,
  alwaysLabel,
  resolution = null,
  resolvedBy,
  resolvedAt,
  onChoose,
  className,
}: PermissionCardProps) {
  if (resolution != null) {
    const Icon = resolution === 'deny' ? X : Check;
    const [firstLine] = command.split('\n');
    return (
      <div
        data-slot="permission-card"
        data-resolution={resolution}
        className={cn(
          'flex items-center gap-2 rounded-(--radius-card) border border-border bg-card px-4 py-3.5 text-ui font-medium text-foreground',
          className,
        )}
      >
        <Icon className="size-4 flex-none text-content-tertiary" />
        <span className="min-w-0 truncate">
          {RESOLVED_LABEL[resolution]}:{' '}
          <code className="rounded-sm bg-canvas px-1 font-mono text-meta">{firstLine}</code>
        </span>
        {resolvedBy != null && (
          <span className="ml-auto flex-none text-meta font-normal text-content-tertiary">
            by {resolvedBy}
            {resolvedAt != null && ` · ${resolvedAt}`}
          </span>
        )}
      </div>
    );
  }
  return (
    <div
      data-slot="permission-card"
      data-resolution="pending"
      className={cn(
        'rounded-(--radius-card) border border-pebble-waiting bg-card px-4 py-3.5',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-ui font-semibold text-foreground">
        <Lock className="size-4 flex-none text-(--chip-confirm-fg)" />
        {title}
      </div>
      <pre className="mt-2.5 mb-0 overflow-auto rounded-xl bg-canvas px-3 py-2.5 font-mono text-meta whitespace-pre-wrap text-content-secondary">
        {command}
      </pre>
      {help != null && <p className="mt-2 mb-0 text-meta text-content-tertiary">{help}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onChoose?.('deny')} className="h-6.5 px-2.25 text-meta">
          Deny
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChoose?.('once')}
          className="h-6.5 px-2.25 text-meta text-content-secondary"
        >
          Allow once
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChoose?.('always')}
          className="h-6.5 px-2.25 text-meta text-content-secondary"
        >
          {alwaysLabel}
        </Button>
      </div>
    </div>
  );
}
