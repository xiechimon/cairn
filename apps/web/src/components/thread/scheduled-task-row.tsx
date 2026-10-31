import { StoneMark } from '../stone/stone-mark.js';
import { Button } from '../ui/button.js';
import { StatusChip } from '../ui/status-chip.js';

export type ScheduledState = 'active' | 'paused' | 'disabled';

export interface ScheduledTaskRowProps {
  name: string;
  trigger: string;
  next?: string;
  state: ScheduledState;
  onOpen?: () => void;
}

const TAG: Record<ScheduledState, { tone: 'done' | 'idle' | 'failed'; label: string }> = {
  active: { tone: 'done', label: 'Active' },
  paused: { tone: 'idle', label: 'Paused' },
  disabled: { tone: 'failed', label: 'Auto-disabled' },
};

export function ScheduledTaskRow({ name, trigger, next, state, onOpen }: ScheduledTaskRowProps) {
  const tag = TAG[state];
  const detail = state === 'active' && next != null ? `${trigger} · next ${next}` : trigger;
  return (
    <Button
      variant="ghost"
      onClick={onOpen}
      data-slot="scheduled-task-row"
      data-state={state}
      className="h-auto w-full justify-start gap-3 rounded-none px-3.5 py-3 text-left text-ui font-normal hover:bg-sidebar-hover"
    >
      <StoneMark tone={state === 'active' ? 'working' : 'idle'} kind="idle" still />
      <span className="min-w-0 flex-1">
        <b className="block truncate font-semibold text-foreground">{name}</b>
        <small className="block truncate text-meta text-content-tertiary">{detail}</small>
      </span>
      <StatusChip tone={tag.tone} className="text-caption">
        {tag.label}
      </StatusChip>
    </Button>
  );
}
