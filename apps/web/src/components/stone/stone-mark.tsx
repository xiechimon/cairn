import { cn } from 'cn';
import {
  AlarmClockOff,
  Check,
  CircleHelp,
  Clock,
  GitPullRequest,
  LoaderCircle,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { PEBBLE_BG, type StoneTone } from './tone.js';

export type StoneKind =
  | 'question'
  | 'plan'
  | 'permission'
  | 'pr'
  | 'running'
  | 'idle'
  | 'snoozed'
  | 'done';

export const STONE_KINDS: readonly StoneKind[] = [
  'question',
  'plan',
  'permission',
  'pr',
  'running',
  'idle',
  'snoozed',
  'done',
];

const KIND_ICON: Record<StoneKind, LucideIcon> = {
  question: CircleHelp,
  plan: Check,
  permission: Lock,
  pr: GitPullRequest,
  running: LoaderCircle,
  idle: Clock,
  snoozed: AlarmClockOff,
  done: Check,
};

export interface StoneMarkProps {
  tone: StoneTone;
  kind: StoneKind;
  still?: boolean;
  className?: string;
}

export function StoneMark({ tone, kind, still = false, className }: StoneMarkProps) {
  const Icon = KIND_ICON[kind];
  const spins = tone === 'working' && !still;
  return (
    <span
      aria-hidden="true"
      data-slot="stone-mark"
      data-tone={tone}
      className={cn(
        'grid size-5.5 flex-none place-items-center rounded-[52%_48%_46%_54%/56%_50%_50%_44%] text-background',
        PEBBLE_BG[tone],
        className,
      )}
    >
      <Icon
        className={cn(
          'size-3.25',
          spins && 'animate-spin [animation-duration:1.6s] motion-reduce:animate-none',
        )}
        strokeWidth={1.75}
      />
    </span>
  );
}
