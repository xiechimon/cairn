import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@cairn/web';

export const Open = () => (
  <TooltipProvider>
    <div style={{ paddingTop: 48, display: 'flex', justifyContent: 'center', width: 280 }}>
      <Tooltip open>
        <TooltipTrigger render={<Button variant="outline" />}>Retry build</TooltipTrigger>
        <TooltipContent>Re-run step 3 of task #104 on omarchy</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

export const Bottom = () => (
  <TooltipProvider>
    <div style={{ paddingBottom: 48, display: 'flex', justifyContent: 'center', width: 280 }}>
      <Tooltip open>
        <TooltipTrigger render={<Button variant="ghost" />}>Implementer</TooltipTrigger>
        <TooltipContent side="bottom">Claude Code · last active 2 min ago</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
