import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';

export function IconTooltip({
  label,
  trigger,
  side = 'top',
  children,
}: {
  label: string;
  trigger: ReactElement;
  side?: 'top' | 'bottom';
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={trigger} aria-label={label}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
