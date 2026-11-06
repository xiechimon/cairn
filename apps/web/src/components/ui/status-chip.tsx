import { cn } from 'cn';
import { CircleAlert, CircleCheck, CircleDashed, CircleX, ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from './badge.js';

const TONE_SKIN = {
  idle: 'bg-secondary text-content-secondary',
  plan: 'bg-secondary text-content-secondary',
  confirm: 'bg-secondary text-(--waiting-ink)',
  done: 'bg-secondary text-content-secondary',
  failed: 'bg-secondary text-destructive',
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
      <Icon aria-hidden="true" />
      {children}
    </Badge>
  );
}
