import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../ui/button.js';

export function GoalLine({ children, onEdit }: { children: ReactNode; onEdit?: () => void }) {
  return (
    <p
      data-slot="goal-line"
      className="m-0 flex items-center gap-2 text-meta text-content-secondary"
    >
      <span className="flex-none text-content-tertiary">Goal</span>
      <span className="min-w-0 truncate">{children}</span>
      {onEdit != null && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit goal"
          onClick={onEdit}
          className="size-5.5 flex-none text-content-tertiary hover:text-foreground"
        >
          <Pencil className="size-3" />
        </Button>
      )}
    </p>
  );
}
