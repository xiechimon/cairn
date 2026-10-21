// Drag overlay face (#616): the lifted clone is a compact card, not the
// board card — title (2 lines) and the project + #id half of the meta row,
// no footer or actions. Lift recipe: 2° tilt, 0.92 opacity, --drag-shadow;
// dnd-kit's fixed wrapper owns the translate.

import { Folder } from 'lucide-react';
import { useLiveData } from '../api/provider.js';
import { PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';

interface DragCardProps {
  todo: TodoRecord;
  /** Project name, same pass-through and absent semantics as the board card. */
  projectName?: string;
}

export function DragCard({ todo, projectName }: DragCardProps) {
  const { live } = useLiveData();
  const project = live ? projectName : (projectName ?? PROJECT_NAME);
  return (
    <div
      className="board-drag-card flex flex-col gap-1.5 rounded-(--radius-card) border border-border bg-card px-3.5 py-3 opacity-[0.92] rotate-2 [box-shadow:var(--drag-shadow)]"
      data-todo-id={todo.id}
    >
      <div className="line-clamp-2 text-card-title font-medium text-card-foreground">
        {todo.title}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-meta whitespace-nowrap text-content-tertiary">
        {project !== undefined && (
          <span className="flex min-w-0 items-center gap-1">
            <Folder aria-hidden strokeWidth={1.75} className="size-3 flex-none text-content-dim" />
            <span className="truncate">{project}</span>
          </span>
        )}
        <span className="flex-none tabular-nums">#{todo.seqNum}</span>
      </div>
    </div>
  );
}
