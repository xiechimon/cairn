import { Button, IconTooltip, TooltipProvider } from '@cairn/web';
import { RefreshCwIcon, SquareIcon, GitMergeIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

function Hovered({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('button');
    if (!el) return;
    el.focus();
  }, []);
  return (
    <TooltipProvider>
      <div ref={ref} style={{ paddingTop: 48, display: 'flex', justifyContent: 'center', width: 200 }}>
        {children}
      </div>
    </TooltipProvider>
  );
}

export const Focused = () => (
  <Hovered>
    <IconTooltip label="Retry build" trigger={<Button variant="ghost" size="icon-sm" />}>
      <RefreshCwIcon />
    </IconTooltip>
  </Hovered>
);

export const Toolbar = () => (
  <div style={{ display: 'flex', gap: 4 }}>
    <IconTooltip label="Retry build" trigger={<Button variant="ghost" size="icon-sm" />}>
      <RefreshCwIcon />
    </IconTooltip>
    <IconTooltip label="Stop task" trigger={<Button variant="ghost" size="icon-sm" />}>
      <SquareIcon />
    </IconTooltip>
    <IconTooltip label="Merge PR #2156" trigger={<Button variant="ghost" size="icon-sm" />}>
      <GitMergeIcon />
    </IconTooltip>
  </div>
);
