import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Badge } from './badge.js';

const TONE_SKIN = {
  idle: 'bg-(--chip-idle-bg) text-(--chip-idle-fg)',
  plan: 'bg-(--chip-plan-bg) text-(--chip-plan-fg)',
  confirm: 'bg-(--chip-confirm-bg) text-(--chip-confirm-fg)',
  done: 'bg-(--chip-done-bg) text-(--chip-done-fg)',
  failed: 'bg-(--chip-failed-bg) text-(--chip-failed-fg)',
} as const;

export type StatusTone = keyof typeof TONE_SKIN;

export interface StatusChipProps {
  tone: StatusTone;
  className?: string;
  children: ReactNode;
}

export function StatusChip({ tone, className, children }: StatusChipProps) {
  return (
    <Badge data-tone={tone} className={cn(TONE_SKIN[tone], className)}>
      {children}
    </Badge>
  );
}
