import { useDraggable } from '@dnd-kit/core';
import type { CardOrchestration } from '../chief/orchestration-inflight.js';
import type { TagChipData } from '../components/ui/tag-chip.js';
import type { TodoRecord } from '../fixtures/records.js';
import { TodoCard } from './todo-card.js';

interface DraggableCardProps {
  todo: TodoRecord;
  now: number;
  onAction?: (todo: TodoRecord) => void;
  onBranch?: (todo: TodoRecord) => void;
  hasBranch?: boolean;
  projectName?: string;
  tag?: TagChipData | null;
  orchestration?: CardOrchestration | null;
}

export function DraggableCard({
  todo,
  now,
  onAction,
  onBranch,
  hasBranch,
  projectName,
  tag,
  orchestration,
}: DraggableCardProps) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: todo.id });
  const style = { opacity: isDragging ? 0.4 : undefined };
  return (
    <div ref={setNodeRef} style={style} {...listeners}>
      <TodoCard
        todo={todo}
        now={now}
        onAction={onAction}
        onBranch={onBranch}
        hasBranch={hasBranch}
        projectName={projectName}
        tag={tag}
        orchestration={orchestration}
      />
    </div>
  );
}
