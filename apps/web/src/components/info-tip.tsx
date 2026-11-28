import { cn } from 'cn';
import { Info } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from './ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';

export function InfoTip({ info, className }: { info: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const pointerOpenRef = useRef<boolean | null>(null);
  const pinnedRef = useRef(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && pinnedRef.current && details.reason === 'trigger-hover') {
          return;
        }
        if (!nextOpen) {
          pinnedRef.current = false;
        }
        setOpen(nextOpen);
      }}
    >
      <TooltipTrigger
        delay={150}
        closeOnClick={false}
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={info}
            data-testid="info-tip"
            onPointerDown={() => {
              pointerOpenRef.current = open;
            }}
            onClick={() => {
              const wasOpen = pointerOpenRef.current;
              pointerOpenRef.current = null;
              const nextOpen = !(wasOpen ?? open);
              pinnedRef.current = nextOpen;
              setOpen(nextOpen);
            }}
            className={cn(
              '-my-1 flex-none align-middle text-content-tertiary hover:text-foreground',
              className,
            )}
          />
        }
      >
        <Info aria-hidden="true" className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {info}
      </TooltipContent>
    </Tooltip>
  );
}
