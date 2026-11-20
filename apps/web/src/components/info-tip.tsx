import { cn } from 'cn';
import { Info } from 'lucide-react';
import { Button } from './ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';

export function InfoTip({ info, className }: { info: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={150}
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={info}
            data-testid="info-tip"
            className={cn(
              '-my-1 flex-none align-middle text-content-tertiary hover:text-foreground',
              className,
            )}
          />
        }
      >
        <Info aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {info}
      </TooltipContent>
    </Tooltip>
  );
}
