import { cn } from 'cn';
import { CircleAlert, CircleCheck, CircleDashed, CircleX, ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from './badge.js';

const TONE_SKIN = {
  idle: 'bg-(--chip-idle-bg) text-(--chip-idle-fg)',
  plan: 'bg-(--chip-plan-bg) text-(--chip-plan-fg)',
  confirm: 'bg-(--chip-confirm-bg) text-(--chip-confirm-fg)',
  done: 'bg-(--chip-done-bg) text-(--chip-done-fg)',
  failed: 'bg-(--chip-failed-bg) text-(--chip-failed-fg)',
} as const;

const TONE_ICON = {
  idle: CircleDashed,
  plan: ListChecks,
  confirm: CircleAlert,
  done: CircleCheck,
  failed: CircleX,
} as const;

export type StatusTone = keyof typeof TONE_SKIN;

export interface StatusChipProps {
  tone: StatusTone;
  className?: string;
  children: ReactNode;
}

export function StatusChip({ tone, className, children }: StatusChipProps) {
  const Icon = TONE_ICON[tone];
  return (
    <Badge data-tone={tone} className={cn('gap-1 pl-1.5', TONE_SKIN[tone], className)}>
      <Icon aria-hidden="true" strokeWidth={2} />
      {children}
    </Badge>
  );
}
